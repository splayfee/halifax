/** Scalar types accepted as filter values. */
export type QueryScalar = string | number | boolean | null

/** A single condition in a WHERE clause, optionally containing nested child conditions. */
export interface IQueryFilter {
  /** The {@link SqlComparison} operator (e.g. `'='`, `'LIKE'`). */
  comparison: string
  /** Column name to filter on. */
  field: string
  /** {@link SqlOperator} joining this condition to the next sibling (`'AND'` | `'OR'`). */
  operator?: string
  /** Primary value (or array of values for `IN` / `NOT IN`). */
  value1?: QueryScalar | QueryScalar[]
  /** Secondary value for range comparisons (`BETWEEN`, `NOT BETWEEN`). */
  value2?: string | number
  /** Nested sub-conditions grouped in parentheses. */
  children?: IQueryFilter[]
}