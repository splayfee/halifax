import type { IQueryFilter } from '@/interfaces/IQueryFilter.js'
import type { ISort } from '@/interfaces/ISort.js'

/** Options passed to the query builder to construct a SELECT, UPDATE, or DELETE statement. */
export interface IQueryOptions {
  /** When true, adds DISTINCT to the SELECT clause. */
  isDistinct?: boolean
  /** Maximum number of rows to return (FETCH NEXT n ROWS ONLY). */
  limit?: number
  /** Number of rows to skip (OFFSET n ROWS). */
  offset?: number
  /** Columns to include in the SELECT clause; omit for `*`. */
  fields?: string[]
  /** Target table name. Required unless set on the adapter. */
  tableName?: string
  /** WHERE conditions. */
  where?: IQueryFilter[]
  /** ORDER BY expressions. */
  orderBy?: ISort[]
}
