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

export type ColumnMap = Record<string, AnyColumn>

function comparisonToDrizzle(filter: IQueryFilter, col: AnyColumn): SQL | undefined {
  const v1 = filter.value1
  const v2 = filter.value2
  const comparison = (filter.comparison?.toUpperCase() ?? '=') as SqlComparison

  switch (comparison) {
    case SqlComparison.Equal:
      return eq(col, v1 as QueryScalar)
    case SqlComparison.NotEqual:
      return ne(col, v1 as QueryScalar)
    case SqlComparison.GreaterThan:
      return gt(col, v1 as QueryScalar)
    case SqlComparison.GreaterThanOrEqual:
      return gte(col, v1 as QueryScalar)
    case SqlComparison.LessThan:
      return lt(col, v1 as QueryScalar)
    case SqlComparison.LessThanOrEqual:
      return lte(col, v1 as QueryScalar)
    case SqlComparison.In:
      return inArray(col, (Array.isArray(v1) ? v1 : [v1]) as QueryScalar[])
    case SqlComparison.NotIn:
      return notInArray(col, (Array.isArray(v1) ? v1 : [v1]) as QueryScalar[])
    case SqlComparison.Between:
      return between(col, v1 as QueryScalar, v2 as QueryScalar)
    case SqlComparison.NotBetween:
      return notBetween(col, v1 as QueryScalar, v2 as QueryScalar)
    case SqlComparison.IsNull:
      return isNull(col)
    case SqlComparison.IsNotNull:
      return isNotNull(col)
    case SqlComparison.Contains:
      return like(col, `%${String(v1 ?? '')}%`)
    case SqlComparison.StartsWith:
      return like(col, `${String(v1 ?? '')}%`)
    case SqlComparison.EndsWith:
      return like(col, `%${String(v1 ?? '')}`)
    case SqlComparison.Like:
      return like(col, String(v1 ?? ''))
    case SqlComparison.NotLike:
      return notLike(col, String(v1 ?? ''))
    default:
      return eq(col, v1 as QueryScalar)
  }
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
