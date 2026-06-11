/**
 * Comparison operators accepted in query-builder WHERE clauses.
 *
 * The classic SQL operators (`=`, `LIKE`, `IN`, `BETWEEN`, …) are kept as-is. The string
 * operators (`CONTAINS`, `STARTS WITH`, `ENDS WITH`) are portable extensions that both
 * Prisma and Drizzle express natively on every dialect, so they behave identically
 * regardless of the underlying database — unlike `LIKE`, whose case-sensitivity varies
 * by engine collation.
 */
export enum SqlComparison {
  Between = 'BETWEEN',
  Contains = 'CONTAINS',
  EndsWith = 'ENDS WITH',
  Equal = '=',
  GreaterThan = '>',
  GreaterThanOrEqual = '>=',
  In = 'IN',
  IsNotNull = 'IS NOT NULL',
  IsNull = 'IS NULL',
  LessThan = '<',
  LessThanOrEqual = '<=',
  Like = 'LIKE',
  NotBetween = 'NOT BETWEEN',
  NotEqual = '<>',
  NotIn = 'NOT IN',
  NotLike = 'NOT LIKE',
  StartsWith = 'STARTS WITH'
}
