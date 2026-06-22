import { Op } from 'sequelize'
import type { IQueryFilter, ISort } from '@edium/halifax-types'
import { SqlComparison, SqlOperator, SqlOrder } from '@edium/halifax-types'
import { buildComparison, type ComparisonStrategyTable } from '../ComparisonStrategy.js'

// Sequelize where clauses use both string field keys and symbol Op.* keys.
type SeqWhere = Record<PropertyKey, unknown>

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/**
 * Per-operator builders for Sequelize `Op` symbol-based where fragments.
 * Mirrors `DRIZZLE_COMPARISONS` and `PRISMA_COMPARISONS` so all three adapters
 * remain behaviourally aligned via the shared `ComparisonStrategy` contract.
 */
const SEQUELIZE_COMPARISONS: ComparisonStrategyTable<SeqWhere, string> = {
  [SqlComparison.Equal]: (f, { v1 }) => ({ [f]: { [Op.eq]: v1 } }) as SeqWhere,
  [SqlComparison.NotEqual]: (f, { v1 }) => ({ [f]: { [Op.ne]: v1 } }) as SeqWhere,
  [SqlComparison.GreaterThan]: (f, { v1 }) => ({ [f]: { [Op.gt]: v1 } }) as SeqWhere,
  [SqlComparison.GreaterThanOrEqual]: (f, { v1 }) => ({ [f]: { [Op.gte]: v1 } }) as SeqWhere,
  [SqlComparison.LessThan]: (f, { v1 }) => ({ [f]: { [Op.lt]: v1 } }) as SeqWhere,
  [SqlComparison.LessThanOrEqual]: (f, { v1 }) => ({ [f]: { [Op.lte]: v1 } }) as SeqWhere,
  [SqlComparison.In]: (f, { v1 }) =>
    ({ [f]: { [Op.in]: Array.isArray(v1) ? v1 : [v1] } }) as SeqWhere,
  [SqlComparison.NotIn]: (f, { v1 }) =>
    ({ [f]: { [Op.notIn]: Array.isArray(v1) ? v1 : [v1] } }) as SeqWhere,
  [SqlComparison.Between]: (f, { v1, v2 }) => ({ [f]: { [Op.between]: [v1, v2] } }) as SeqWhere,
  [SqlComparison.NotBetween]: (f, { v1, v2 }) =>
    ({ [f]: { [Op.notBetween]: [v1, v2] } }) as SeqWhere,
  [SqlComparison.IsNull]: (f) => ({ [f]: { [Op.is]: null } }) as SeqWhere,
  // Op.not: null generates IS NOT NULL; Op.ne: null would generate != NULL (wrong)
  [SqlComparison.IsNotNull]: (f) => ({ [f]: { [Op.not]: null } }) as SeqWhere,
  [SqlComparison.Contains]: (f, { v1 }) =>
    ({ [f]: { [Op.like]: `%${escapeLike(String(v1 ?? ''))}%` } }) as SeqWhere,
  [SqlComparison.StartsWith]: (f, { v1 }) =>
    ({ [f]: { [Op.like]: `${escapeLike(String(v1 ?? ''))}%` } }) as SeqWhere,
  [SqlComparison.EndsWith]: (f, { v1 }) =>
    ({ [f]: { [Op.like]: `%${escapeLike(String(v1 ?? ''))}` } }) as SeqWhere,
  [SqlComparison.Like]: (f, { v1 }) => ({ [f]: { [Op.like]: String(v1 ?? '') } }) as SeqWhere,
  [SqlComparison.NotLike]: (f, { v1 }) => ({ [f]: { [Op.notLike]: String(v1 ?? '') } }) as SeqWhere
}

function nodeToSequelize(filter: IQueryFilter, fields: Set<string>): SeqWhere | undefined {
  if (!fields.has(filter.field)) return undefined
  const self = buildComparison(filter, filter.field, SEQUELIZE_COMPARISONS)
  if (!filter.children?.length) return self
  const childWhere = astToSequelizeWhere(filter.children, fields)
  if (!childWhere) return self
  const op = (filter.operator?.toUpperCase() as SqlOperator) === SqlOperator.Or ? Op.or : Op.and
  return { [op]: [self, childWhere] } as SeqWhere
}

/**
 * Translates a validated query-builder WHERE tree into a Sequelize `where` object.
 *
 * Logical precedence mirrors Prisma and Drizzle AST compilers: AND binds tighter than OR,
 * so the filter list is split into OR-separated groups of AND-runs.
 *
 * @param where - The validated filter list from {@link IQueryOptions.where}.
 * @param fields - Set of known field names (filters referencing unknown fields are silently dropped).
 * @returns A Sequelize where object, or `undefined` when there are no filters.
 */
export function astToSequelizeWhere(
  where: IQueryFilter[] | undefined,
  fields: Set<string>
): SeqWhere | undefined {
  if (!where?.length) return undefined

  const groups: (SeqWhere | undefined)[][] = [[]]
  where.forEach((filter, index) => {
    groups[groups.length - 1]!.push(nodeToSequelize(filter, fields))
    const joinsWithOr =
      !filter.children?.length && (filter.operator?.toUpperCase() as SqlOperator) === SqlOperator.Or
    if (joinsWithOr && index < where.length - 1) groups.push([])
  })

  const andify = (group: (SeqWhere | undefined)[]): SeqWhere | undefined => {
    const valid = group.filter(Boolean) as SeqWhere[]
    if (valid.length === 0) return undefined
    if (valid.length === 1) return valid[0]
    return { [Op.and]: valid } as SeqWhere
  }

  if (groups.length === 1) return andify(groups[0]!)
  const orParts = groups.map(andify).filter(Boolean) as SeqWhere[]
  if (orParts.length === 0) return undefined
  if (orParts.length === 1) return orParts[0]
  return { [Op.or]: orParts } as SeqWhere
}

/**
 * Converts the AST `orderBy` into Sequelize order tuples.
 * @returns An array of `[field, 'ASC' | 'DESC']` tuples ready for `findAll({ order })`.
 */
export function astToSequelizeOrder(orderBy?: ISort[]): [string, 'ASC' | 'DESC'][] {
  if (!orderBy?.length) return []
  return orderBy.map((s) => [s.field, s.order.toUpperCase() === SqlOrder.DESC ? 'DESC' : 'ASC'])
}
