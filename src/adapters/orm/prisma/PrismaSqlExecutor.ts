import type { ExecuteValue } from '@edium/halifax-types'
import type { SqlExecutor } from '@/core/execute.js'
import { placeholders, quoteRoutineName, type SqlDialect } from '@/core/sqlIdentifier.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'

/** The minimal slice of a Prisma client the executor needs (`$queryRawUnsafe`/`$executeRawUnsafe`). */
export interface PrismaRawClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
  /** Prisma's internal active-provider hint, used to auto-detect the dialect. */
  _activeProvider?: string
}

/** Construction options for {@link PrismaSqlExecutor}. */
export interface PrismaSqlExecutorOptions {
  /**
   * SQL dialect. When omitted, auto-detected from the Prisma client's active provider
   * (`postgresql`/`cockroachdb` → `postgres`, `mysql` → `mysql`, `sqlserver` → `mssql`).
   */
  dialect?: SqlDialect
}

/** Postgres raises SQLSTATE 42809 (`wrong_object_type`) when a procedure is called via `SELECT`. */
function isWrongObjectType(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string }; message?: string }
  if (e?.code === '42809' || e?.meta?.code === '42809') return true
  const message = typeof e?.message === 'string' ? e.message.toLowerCase() : ''
  return message.includes('is a procedure') || message.includes('use call')
}

/** Narrows a raw-query result to a row array (raw routine calls always return an array or nothing). */
function toRows(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : []
}

function detectDialect(client: PrismaRawClient, explicit?: SqlDialect): SqlDialect {
  if (explicit) return explicit
  const provider = client._activeProvider
  if (provider === 'mysql') return 'mysql'
  if (provider === 'postgresql' || provider === 'cockroachdb') return 'postgres'
  if (provider === 'sqlserver') return 'mssql'
  if (provider === 'sqlite')
    throw new NotImplementedError(
      'SQLite has no stored procedures, so PrismaSqlExecutor cannot run on a SQLite datasource.'
    )
  throw new NotImplementedError(
    `PrismaSqlExecutor cannot auto-detect a dialect for provider '${String(provider)}'. ` +
      `Pass { dialect: 'postgres' | 'mysql' | 'mssql' } explicitly.`
  )
}

/**
 * A {@link SqlExecutor} backed by a Prisma client. Calls a routine by name with positional,
 * parameter-bound arguments and returns its rows.
 *
 * **"Just works" across routine kinds:**
 * - **MySQL** — issued as `CALL name(?, …)` (returns result sets for both procedures and functions).
 * - **SQL Server** — issued as `EXEC name @P1, … ` (stored procedures return their result sets directly).
 * - **Postgres** — issued as `SELECT * FROM name($1, …)` (functions); if the routine turns out to be
 *   a `PROCEDURE` (SQLSTATE 42809), it transparently falls back to `CALL name($1, …)` and returns
 *   an empty row set. The classification is cached per name so the fallback happens at most once.
 *
 * SQLite is unsupported (it has no stored routines) — auto-detection throws a clear error for it.
 */
export class PrismaSqlExecutor implements SqlExecutor {
  private readonly client: PrismaRawClient
  private readonly dialect: SqlDialect
  /** Per-name cache of whether a Postgres routine is a procedure (true) or function (false). */
  private readonly isProcedure = new Map<string, boolean>()

  public constructor(client: PrismaRawClient, options: PrismaSqlExecutorOptions = {}) {
    this.client = client
    this.dialect = detectDialect(client, options.dialect)
  }

  public async call(name: string, params: ExecuteValue[]): Promise<unknown[]> {
    const quoted = quoteRoutineName(name, this.dialect)
    const args = placeholders(params.length, this.dialect)

    if (this.dialect === 'mysql') {
      return toRows(
        await this.client.$queryRawUnsafe<unknown>(`CALL ${quoted}(${args})`, ...params)
      )
    }

    if (this.dialect === 'mssql') {
      // SQL Server stored procedures return their result sets directly from EXEC.
      const exec = args ? `EXEC ${quoted} ${args}` : `EXEC ${quoted}`
      return toRows(await this.client.$queryRawUnsafe<unknown>(exec, ...params))
    }

    // Postgres: prefer the function form, fall back to CALL for procedures (cached).
    if (this.isProcedure.get(name) === true) {
      await this.client.$executeRawUnsafe(`CALL ${quoted}(${args})`, ...params)
      return []
    }
    try {
      const rows = await this.client.$queryRawUnsafe<unknown>(
        `SELECT * FROM ${quoted}(${args})`,
        ...params
      )
      this.isProcedure.set(name, false)
      return toRows(rows)
    } catch (error) {
      if (!isWrongObjectType(error)) throw error
      this.isProcedure.set(name, true)
      await this.client.$executeRawUnsafe(`CALL ${quoted}(${args})`, ...params)
      return []
    }
  }
}
