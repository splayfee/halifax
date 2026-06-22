import { sql, type SQL } from 'drizzle-orm'
import type { ExecuteValue } from '@edium/halifax-types'
import type { SqlExecutor } from '@/core/execute.js'
import { quoteRoutineName } from '@/core/sqlIdentifier.js'

/** Dialects Drizzle can run stored routines on. SQL Server is Prisma-only — Drizzle has no MSSQL driver. */
export type DrizzleSqlDialect = 'postgres' | 'mysql'

/** The minimal slice of a Drizzle database the executor needs. */
export interface DrizzleDb {
  execute(query: SQL): Promise<unknown>
}

/** Construction options for {@link DrizzleSqlExecutor}. */
export interface DrizzleSqlExecutorOptions {
  /** SQL dialect. Defaults to `'postgres'`. */
  dialect?: DrizzleSqlDialect
}

/** Postgres raises SQLSTATE 42809 (`wrong_object_type`) when a procedure is called via `SELECT`. */
function isWrongObjectType(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string }; message?: string }
  if (e?.code === '42809' || e?.cause?.code === '42809') return true
  const message = typeof e?.message === 'string' ? e.message.toLowerCase() : ''
  return message.includes('is a procedure') || message.includes('use call')
}

/** Normalizes the various driver return shapes into a flat row array. */
function normalizeRows(result: unknown): unknown[] {
  if (result == null) return []
  const withRows = result as { rows?: unknown }
  if (Array.isArray(withRows.rows)) return withRows.rows // pg / node-postgres
  if (Array.isArray(result)) {
    // mysql2 returns `[rows, fields]`; everything else is already a row array.
    if (result.length > 0 && Array.isArray(result[0])) return result[0] as unknown[]
    return result
  }
  return []
}

/**
 * A {@link SqlExecutor} backed by a Drizzle database. Calls a routine by name with positional,
 * parameter-bound arguments (via Drizzle's `sql` tagged template) and returns its rows.
 *
 * - **Postgres** — `SELECT * FROM name($1, …)` for functions; transparently falls back to
 *   `CALL name($1, …)` when the routine is a `PROCEDURE` (SQLSTATE 42809), returning no rows.
 * - **MySQL** — `CALL name(?, …)`.
 *
 * Return-shape normalization is best-effort across drivers; provide a custom {@link SqlExecutor}
 * if your driver returns an unusual envelope.
 */
export class DrizzleSqlExecutor implements SqlExecutor {
  private readonly db: DrizzleDb
  private readonly dialect: DrizzleSqlDialect
  private readonly isProcedure = new Map<string, boolean>()

  public constructor(db: DrizzleDb, options: DrizzleSqlExecutorOptions = {}) {
    this.db = db
    this.dialect = options.dialect ?? 'postgres'
  }

  private buildArgs(params: ExecuteValue[]): SQL {
    if (params.length === 0) return sql.raw('')
    return sql.join(
      params.map((p) => sql`${p}`),
      sql.raw(', ')
    )
  }

  public async call(name: string, params: ExecuteValue[]): Promise<unknown[]> {
    const quoted = sql.raw(quoteRoutineName(name, this.dialect))
    const args = this.buildArgs(params)

    if (this.dialect === 'mysql') {
      return normalizeRows(await this.db.execute(sql`CALL ${quoted}(${args})`))
    }

    if (this.isProcedure.get(name) === true) {
      await this.db.execute(sql`CALL ${quoted}(${args})`)
      return []
    }
    try {
      const result = await this.db.execute(sql`SELECT * FROM ${quoted}(${args})`)
      this.isProcedure.set(name, false)
      return normalizeRows(result)
    } catch (error) {
      if (!isWrongObjectType(error)) throw error
      this.isProcedure.set(name, true)
      await this.db.execute(sql`CALL ${quoted}(${args})`)
      return []
    }
  }
}
