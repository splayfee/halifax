import type { IQueryFilter } from '@/interfaces/IQueryFilter.js'
import type { ISort } from '@/interfaces/ISort.js'

/** The query-builder AST: a validated description of a filtered, sorted, paginated read. */
export interface IQueryOptions {
  /**
   * Return only rows distinct on these columns. Portable across Prisma and Drizzle
   * (`distinct` / `DISTINCT ON`). Columns are validated against the resource like any other field.
   */
  distinct?: string[]
  /** Maximum number of rows to return. */
  limit?: number
  /** Number of rows to skip (for pagination). */
  offset?: number
  /** Columns to include in the result; omit to return all. */
  fields?: string[]
  /** WHERE conditions. */
  where?: IQueryFilter[]
  /** ORDER BY expressions. */
  orderBy?: ISort[]
}
