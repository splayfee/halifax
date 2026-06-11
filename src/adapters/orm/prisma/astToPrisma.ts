import { SqlComparison } from '@/enums/SqlComparison.js'
import { SqlOperator } from '@/enums/SqlOperator.js'
import { SqlOrder } from '@/enums/SqlOrder.js'
import type { IQueryFilter, QueryScalar } from '@/interfaces/IQueryFilter.js'
import type { ISort } from '@/interfaces/ISort.js'

/** A Prisma `where` fragment — an arbitrary nested object of field conditions and AND/OR/NOT groups. */
export type PrismaWhere = Record<string, unknown>

/**
 * Splits a `LIKE` pattern into a Prisma string operator based on its `%` wildcards.
 * `%x%` → `contains`, `x%` → `startsWith`, `%x` → `endsWith`, and a wildcard-free value
 * collapses to `equals` (matching SQL `LIKE 'x'` semantics).
 * @param value - The raw LIKE pattern.
 * @returns A Prisma string-filter object.
 */
function likeToPrisma(value: QueryScalar | QueryScalar[] | undefined): Record<string, unknown> {
  const text = String(value ?? '')
  const lead = text.startsWith('%')
  const trail = text.endsWith('%')
  const inner = text.replace(/^%/, '').replace(/%$/, '')
  if (lead && trail) return { contains: inner }
  if (trail) return { startsWith: inner }
  if (lead) return { endsWith: inner }
  return { equals: text }
}

/**
 * Converts a single {@link IQueryFilter} comparison into a Prisma `where` fragment for one field.
 *
 * Most comparisons map to `{ [field]: { <op>: value } }`; `NOT BETWEEN` and `NOT LIKE`
 * expand to `OR` / `NOT` groups. This is the only place comparison semantics live, so the
 * delegate query path and the (validated) AST stay in lockstep.
 *
 * @param filter - The filter whose `field`, `comparison`, `value1`, and `value2` are read.
 * @returns A Prisma `where` fragment expressing the comparison.
 */
function comparisonToPrisma(filter: IQueryFilter): PrismaWhere {
  const field = filter.field
  const v1 = filter.value1
  const v2 = filter.value2
  const comparison = (filter.comparison?.toUpperCase() ?? '=') as SqlComparison

  switch (comparison) {
    case SqlComparison.Equal:
      return { [field]: { equals: v1 } }
    case SqlComparison.NotEqual:
      return { [field]: { not: v1 } }
    case SqlComparison.GreaterThan:
      return { [field]: { gt: v1 } }
    case SqlComparison.GreaterThanOrEqual:
      return { [field]: { gte: v1 } }
    case SqlComparison.LessThan:
      return { [field]: { lt: v1 } }
    case SqlComparison.LessThanOrEqual:
      return { [field]: { lte: v1 } }
    case SqlComparison.In:
      return { [field]: { in: Array.isArray(v1) ? v1 : [v1] } }
    case SqlComparison.NotIn:
      return { [field]: { notIn: Array.isArray(v1) ? v1 : [v1] } }
    case SqlComparison.Between:
      return { [field]: { gte: v1, lte: v2 } }
    case SqlComparison.NotBetween:
      return { OR: [{ [field]: { lt: v1 } }, { [field]: { gt: v2 } }] }
    case SqlComparison.IsNull:
      return { [field]: null }
    case SqlComparison.IsNotNull:
      return { [field]: { not: null } }
    case SqlComparison.Contains:
      return { [field]: { contains: String(v1 ?? '') } }
    case SqlComparison.StartsWith:
      return { [field]: { startsWith: String(v1 ?? '') } }
    case SqlComparison.EndsWith:
      return { [field]: { endsWith: String(v1 ?? '') } }
    case SqlComparison.Like:
      return { [field]: likeToPrisma(v1) }
    case SqlComparison.NotLike:
      return { NOT: { [field]: likeToPrisma(v1) } }
    default:
      return { [field]: { equals: v1 } }
  }
}

/**
 * Translates one filter node into a Prisma fragment. When the node has nested `children`,
 * its own condition is combined with the (parenthesised) children group using the node's
 * `operator` — so `{ ...cond, operator: 'OR', children }` becomes `cond OR (children)` and
 * `operator: 'AND'` (or omitted) becomes `cond AND (children)`, exactly as the original SQL
 * builder rendered it.
 * @param filter - The filter node.
 * @returns The Prisma fragment for this node (and its children, if any).
 */
function nodeToPrisma(filter: IQueryFilter): PrismaWhere {
  const self = comparisonToPrisma(filter)
  if (filter.children?.length) {
    const childWhere = astToPrismaWhere(filter.children)
    return (filter.operator?.toUpperCase() as SqlOperator) === SqlOperator.Or
      ? { OR: [self, childWhere] }
      : { AND: [self, childWhere] }
  }
  return self
}

/**
 * Translates a validated query-builder WHERE tree ({@link IQueryFilter}[]) into a Prisma
 * `where` object.
 *
 * Logical precedence matches SQL: each filter's `operator` joins it to the *next* sibling,
 * `AND` binds tighter than `OR`, so the list is split into OR-separated groups of AND-runs.
 * A single condition is returned bare; an all-AND list as `{ AND: [...] }`; mixed operators
 * as `{ OR: [{ AND: [...] }, ...] }`.
 *
 * This runs **after** {@link validateAdvancedQuery}, so every field name and comparison has
 * already been checked — the 4xx errors are raised there, never inside Prisma.
 *
 * @param where - The validated filter list (may be empty/undefined).
 * @returns A Prisma `where` object (empty `{}` when there are no filters).
 */
export function astToPrismaWhere(where?: IQueryFilter[]): PrismaWhere {
  if (!where?.length) return {}

  const groups: PrismaWhere[][] = [[]]
  where.forEach((filter, index) => {
    groups[groups.length - 1]!.push(nodeToPrisma(filter))
    // A node with children has consumed its operator to join self↔children, so it does not
    // also split sibling groups; only a childless node's `OR` starts a new OR-group.
    const joinsWithOr =
      !filter.children?.length && (filter.operator?.toUpperCase() as SqlOperator) === SqlOperator.Or
    if (joinsWithOr && index < where.length - 1) groups.push([])
  })

  const andify = (group: PrismaWhere[]): PrismaWhere =>
    group.length === 1 ? group[0]! : { AND: group }

  if (groups.length === 1) return andify(groups[0]!)
  return { OR: groups.map(andify) }
}

/**
 * Converts the AST `orderBy` ({@link ISort}[]) into a Prisma `orderBy` array.
 * @param orderBy - Sort expressions from the query AST.
 * @returns A Prisma `orderBy` array, or `undefined` when there are no sorts.
 */
export function astToPrismaOrderBy(
  orderBy?: ISort[]
): Array<Record<string, 'asc' | 'desc'>> | undefined {
  if (!orderBy?.length) return undefined
  return orderBy.map((sort) => ({
    [sort.field]: sort.order.toUpperCase() === SqlOrder.DESC ? 'desc' : 'asc'
  }))
}
