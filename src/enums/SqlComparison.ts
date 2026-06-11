/** SQL comparison operators used in query-builder WHERE clauses. */
export enum SqlComparison {
  Between = 'BETWEEN',
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
  NotLike = 'NOT LIKE'
}
