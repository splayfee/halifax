import type { ExecuteValue } from '@edium/halifax-types'
import type { SqlExecutor } from '@/core/execute.js'
import { quoteRoutineName } from '@/core/sqlIdentifier.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'

/** SQL dialects `SequelizeSqlExecutor` can run stored routines on. */
export type SequelizeSqlDialect = 'postgres' | 'mysql' | 'mssql'

/** Minimal slice of a Sequelize instance needed to execute raw queries. */
export interface SeqRawClient {
  query(sql: string, options?: object): Promise<unknown>
  getDialect(): string
}

/** Construction options for {@link SequelizeSqlExecutor}. */
export interface SequelizeSqlExecutorOptions {
  /**
   * SQL dialect. When omitted, auto-detected from `sequelize.getDialect()`.
   * `'mysql'` covers both MySQL and MariaDB. SQLite throws — it has no stored routines.
   */
  dialect?: SequelizeSqlDialect
}

function detectDialect(seq: SeqRawClient, explicit?: SequelizeSqlDialect): SequelizeSqlDialect {
  if (explicit) return explicit
  const d = seq.getDialect()
  if (d === 'mysql' || d === 'mariadb') return 'mysql'
  if (d === 'postgres' || d === 'cockroachdb') return 'postgres'
  if (d === 'mssql') return 'mssql'
  if (d === 'sqlite')
    throw new NotImplementedError(
      'SQLite has no stored routines. SequelizeSqlExecutor requires postgres, mysql, or mssql.'
    )
  throw new NotImplementedError(
    `SequelizeSqlExecutor cannot auto-detect a dialect for '${d}'. ` +
      `Pass { dialect: 'postgres' | 'mysql' | 'mssql' } explicitly.`
  )
}

/** Postgres raises SQLSTATE 42809 (`wrong_object_type`) when a procedure is called via `SELECT`. */
function isWrongObjectType(error: unknown): boolean {
  const e = error as { code?: string; parent?: { code?: string }; original?: { code?: string }; message?: string }
  if (e?.code === '42809' || e?.parent?.code === '42809' || e?.original?.code === '42809') return true
  const msg = typeof e?.message === 'string' ? e.message.toLowerCase() : ''
  return msg.includes('is a procedure') || msg.includes('use call')
}

/** Normalizes the Sequelize CALL/EXEC result shape into a flat row array. */
function toRows(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  // Sequelize's MySQL/MariaDB dialect intercepts CALL queries via `isCallQuery()` before the
  // RAW handler fires. It returns `data[0]` from mysql2's result (the first result set), so
  // `sequelize.query()` resolves with the rows array directly: `[{col: val}, ...]`.
  // For the MSSQL path (EXEC, not CALL), `isRawQuery()` fires instead and returns `[data, data]`
  // — the caller unwraps to `data` before passing here, so we still receive the rows array.
  // Either way, if the first element is itself an array we have a nested result-set structure
  // and drill in one more level.
  if (value.length > 0 && Array.isArray(value[0])) {
    const inner = value[0] as unknown[]
    if (inner.length > 0 && Array.isArray(inner[0])) return inner[0] as unknown[]
    return inner
  }
  return value
}

/**
 * A {@link SqlExecutor} backed by a Sequelize instance. Calls a routine by name with positional,
 * parameter-bound arguments and returns its rows.
 *
 * - **Postgres** — `SELECT * FROM "fn"($1, …)` for functions; automatically falls back to
 *   `CALL "fn"($1, …)` on SQLSTATE 42809 (wrong_object_type) when the routine is a PROCEDURE.
 *   Uses Sequelize `bind` parameters (real prepared statements via the pg driver).
 * - **MySQL / MariaDB** — `CALL \`fn\`(?, …)` via `replacements` (Sequelize text-protocol path,
 *   no prepared-statement restriction). This works even when using Prisma's `@prisma/adapter-mariadb`
 *   alongside, since Sequelize talks directly to the driver.
 * - **SQL Server** — `EXEC [fn] ?, …` via `replacements`.
 *
 * SQLite is unsupported (it has no stored routines) — auto-detection throws a clear error for it.
 */
export class SequelizeSqlExecutor implements SqlExecutor {
  private readonly seq: SeqRawClient
  private readonly dialect: SequelizeSqlDialect
  /** Caches per-name Postgres routine classification (function vs. procedure). */
  private readonly isProcedure = new Map<string, boolean>()

  public constructor(seq: SeqRawClient, options: SequelizeSqlExecutorOptions = {}) {
    this.seq = seq
    this.dialect = detectDialect(seq, options.dialect)
  }

  public async call(name: string, params: ExecuteValue[]): Promise<unknown[]> {
    const quoted = quoteRoutineName(name, this.dialect)
    const n = params.length

    if (this.dialect === 'mysql') {
      const marks = Array.from({ length: n }, () => '?').join(', ')
      // Sequelize's MySQL dialect handles CALL before RAW: `isCallQuery()` fires and returns
      // `data[0]` from mysql2 (the first result set). `sequelize.query()` resolves with the
      // rows array directly — no outer tuple to unwrap.
      const result = await this.seq.query(`CALL ${quoted}(${marks})`, {
        replacements: params as unknown[],
        type: 'RAW'
      })
      return toRows(result)
    }

    if (this.dialect === 'mssql') {
      const marks = Array.from({ length: n }, () => '?').join(', ')
      const sql = marks ? `EXEC ${quoted} ${marks}` : `EXEC ${quoted}`
      const result = (await this.seq.query(sql, {
        replacements: params as unknown[],
        type: 'RAW'
      })) as [unknown, unknown]
      return toRows(result[0])
    }

    // Postgres: prefer SELECT * FROM fn($1,...), fall back to CALL on SQLSTATE 42809 (cached).
    const args = Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', ')
    if (this.isProcedure.get(name) === true) {
      await this.seq.query(`CALL ${quoted}(${args})`, { bind: params as unknown[], type: 'RAW' })
      return []
    }
    try {
      const rows = (await this.seq.query(`SELECT * FROM ${quoted}(${args})`, {
        bind: params as unknown[],
        type: 'SELECT'
      })) as unknown[]
      this.isProcedure.set(name, false)
      return Array.isArray(rows) ? rows : []
    } catch (error) {
      if (!isWrongObjectType(error)) throw error
      this.isProcedure.set(name, true)
      await this.seq.query(`CALL ${quoted}(${args})`, { bind: params as unknown[], type: 'RAW' })
      return []
    }
  }
}
