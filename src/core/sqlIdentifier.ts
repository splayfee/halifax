import { ServerError } from '@/errors/ServerError.js'

/** SQL dialects the shipped {@link SqlExecutor} implementations know how to call routines on. */
export type SqlDialect = 'postgres' | 'mysql' | 'mssql'

/** A single identifier segment: a leading letter/underscore then letters/digits/underscore/`$`. */
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_$]*$/

/**
 * Validates a (optionally schema-qualified) routine name as a sequence of safe SQL identifier
 * segments. This is defense-in-depth behind the `/execute` whitelist: even a whitelisted name is
 * re-checked so a malformed entry can never be interpolated into SQL.
 * @throws {@link ServerError} when any segment is not a plain identifier.
 */
export function assertSafeRoutineName(name: string): string[] {
  const segments = name.split('.')
  if (segments.length === 0 || segments.length > 2 || !segments.every((s) => SEGMENT.test(s)))
    throw new ServerError(`Unsafe routine name: '${name}'.`)
  return segments
}

/** Quotes a (optionally schema-qualified) routine name for the given dialect. */
export function quoteRoutineName(name: string, dialect: SqlDialect): string {
  const segments = assertSafeRoutineName(name)
  // Segments are already validated to contain no quote characters, so wrapping is sufficient.
  // SQL Server uses [bracket] quoting; MySQL uses backticks; Postgres uses double quotes.
  const wrap =
    dialect === 'mysql'
      ? (s: string) => `\`${s}\``
      : dialect === 'mssql'
        ? (s: string) => `[${s}]`
        : (s: string) => `"${s}"`
  return segments.map(wrap).join('.')
}

/**
 * Builds the positional placeholder list for a dialect: `$1,$2` (Postgres), `?,?` (MySQL),
 * `@P1,@P2` (SQL Server — the placeholder form Prisma's mssql connector expects).
 */
export function placeholders(count: number, dialect: SqlDialect): string {
  if (dialect === 'mysql') return Array.from({ length: count }, () => '?').join(', ')
  const prefix = dialect === 'mssql' ? '@P' : '$'
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`).join(', ')
}
