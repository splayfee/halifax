import {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  notLike,
  inArray,
  notInArray,
  between,
  notBetween,
  isNull,
  isNotNull,
  and,
  or,
  asc,
  desc
} from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type { IQueryFilter, ISort, QueryScalar } from '@edium/halifax-types'
import { SqlComparison, SqlOperator, SqlOrder } from '@edium/halifax-types'
import { buildComparison, type ComparisonStrategyTable } from '../ComparisonStrategy.js'

export type ColumnMap = Record<string, AnyColumn>

/** Escapes SQL LIKE metacharacters in a literal value so it is treated as a plain string. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/**
 * Per-operator builders mapping each {@link SqlComparison} to a Drizzle SQL condition for one
 * column. This table is the only place Drizzle comparison semantics live, mirroring
 * `PRISMA_COMPARISONS` so both adapters stay behaviourally aligned.
 */
const DRIZZLE_COMPARISONS: ComparisonStrategyTable<SQL | undefined, AnyColumn> = {
  [SqlComparison.Equal]: (col, { v1 }) => eq(col, v1 as QueryScalar),
  [SqlComparison.NotEqual]: (col, { v1 }) => ne(col, v1 as QueryScalar),
  [SqlComparison.GreaterThan]: (col, { v1 }) => gt(col, v1 as QueryScalar),
  [SqlComparison.GreaterThanOrEqual]: (col, { v1 }) => gte(col, v1 as QueryScalar),
  [SqlComparison.LessThan]: (col, { v1 }) => lt(col, v1 as QueryScalar),
  [SqlComparison.LessThanOrEqual]: (col, { v1 }) => lte(col, v1 as QueryScalar),
  [SqlComparison.In]: (col, { v1 }) =>
    inArray(col, (Array.isArray(v1) ? v1 : [v1]) as QueryScalar[]),
  [SqlComparison.NotIn]: (col, { v1 }) =>
    notInArray(col, (Array.isArray(v1) ? v1 : [v1]) as QueryScalar[]),
  [SqlComparison.Between]: (col, { v1, v2 }) => between(col, v1 as QueryScalar, v2 as QueryScalar),
  [SqlComparison.NotBetween]: (col, { v1, v2 }) =>
    notBetween(col, v1 as QueryScalar, v2 as QueryScalar),
  [SqlComparison.IsNull]: (col) => isNull(col),
  [SqlComparison.IsNotNull]: (col) => isNotNull(col),
  [SqlComparison.Contains]: (col, { v1 }) => like(col, `%${escapeLike(String(v1 ?? ''))}%`),
  [SqlComparison.StartsWith]: (col, { v1 }) => like(col, `${escapeLike(String(v1 ?? ''))}%`),
  [SqlComparison.EndsWith]: (col, { v1 }) => like(col, `%${escapeLike(String(v1 ?? ''))}`),
  [SqlComparison.Like]: (col, { v1 }) => like(col, String(v1 ?? '')),
  [SqlComparison.NotLike]: (col, { v1 }) => notLike(col, String(v1 ?? ''))
}

/** Converts a single {@link IQueryFilter} comparison into a Drizzle SQL condition for its column. */
function comparisonToDrizzle(filter: IQueryFilter, col: AnyColumn): SQL | undefined {
  return buildComparison(filter, col, DRIZZLE_COMPARISONS)
}

function nodeToDrizzle(filter: IQueryFilter, columns: ColumnMap): SQL | undefined {
  const col = columns[filter.field]
  if (!col) return undefined

  const self = comparisonToDrizzle(filter, col)
  if (!self) return undefined

  if (filter.children?.length) {
    const childWhere = astToDrizzleWhere(filter.children, columns)
    if (!childWhere) return self
    return (filter.operator?.toUpperCase() as SqlOperator) === SqlOperator.Or
      ? or(self, childWhere)
      : and(self, childWhere)
  }
  return self
}

/**
 * Translates a validated query-builder WHERE tree into Drizzle SQL conditions.
 *
 * Logical precedence mirrors the Prisma AST compiler: AND binds tighter than OR, so the
 * filter list is split into OR-separated groups of AND-runs.
 *
 * @param where - The validated filter list from {@link IQueryOptions.where}.
 * @param columns - Column map derived from `getTableColumns(table)`.
 * @returns A Drizzle `SQL` condition, or `undefined` when there are no filters.
 */
export function astToDrizzleWhere(
  where: IQueryFilter[] | undefined,
  columns: ColumnMap
): SQL | undefined {
  if (!where?.length) return undefined

  const groups: (SQL | undefined)[][] = [[]]
  where.forEach((filter, index) => {
    groups[groups.length - 1]!.push(nodeToDrizzle(filter, columns))
    // A node with children has consumed its operator to join self↔children; only
    // a childless node's OR starts a new sibling group.
    const joinsWithOr =
      !filter.children?.length && (filter.operator?.toUpperCase() as SqlOperator) === SqlOperator.Or
    if (joinsWithOr && index < where.length - 1) groups.push([])
  })

  const andify = (group: (SQL | undefined)[]): SQL | undefined => {
    const valid = group.filter(Boolean) as SQL[]
    if (valid.length === 0) return undefined
    if (valid.length === 1) return valid[0]
    return and(...valid)
  }

  if (groups.length === 1) return andify(groups[0]!)

  const orParts = groups.map(andify).filter(Boolean) as SQL[]
  if (orParts.length === 0) return undefined
  if (orParts.length === 1) return orParts[0]
  return or(...orParts)
}

/**
 * Converts the AST `orderBy` ({@link ISort}[]) into Drizzle order expressions.
 * @param orderBy - Sort expressions from the query AST.
 * @param columns - Column map derived from `getTableColumns(table)`.
 * @returns An array of Drizzle order expressions (empty when there are no sorts).
 */
export function astToDrizzleOrderBy(orderBy: ISort[] | undefined, columns: ColumnMap): SQL[] {
  if (!orderBy?.length) return []
  return orderBy
    .filter((sort) => columns[sort.field])
    .map((sort) => {
      const col = columns[sort.field]!
      return sort.order.toUpperCase() === SqlOrder.DESC ? desc(col) : asc(col)
    })
}
