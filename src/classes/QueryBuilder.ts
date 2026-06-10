import { SqlComparison } from '@/enums/SqlComparison.js'
import { PayloadError } from '@/errors/PayloadError.js'
import type { IParamQuery } from '@/interfaces/IParamQuery.js'
import type { IQueryFilter, QueryScalar } from '@/interfaces/IQueryFilter.js'
import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'
import type { ISort } from '@/interfaces/ISort.js'

function isDefined(value: unknown): boolean {
  return value !== undefined && value !== null
}

// PostgreSQL uses $1, $2, ... placeholders; replace the internal '?' markers in order.
function numberParams(statement: string): string {
  let i = 0
  return statement.replace(/\?/g, () => `$${++i}`)
}

function addFields(fields: string[] | undefined): string {
  return fields?.length ? fields.join(',') : '*'
}

function addFrom(tableName?: string): string {
  if (!tableName) {
    throw new PayloadError('The query builder requires a table name.')
  }
  return `FROM ${tableName}`
}

function addOrderBy(queryOptions: IQueryOptions): string {
  const order: ISort[] = queryOptions.orderBy ?? []
  const orderClauses = order.map((sort: ISort) => {
    return `${sort.field} ${sort.order}`
  })

  if (orderClauses.length === 0) {
    orderClauses.push('id ASC')
  }

  return `ORDER BY ${orderClauses.join(',')}`
}

function addSelectionFilter(queryItems: IQueryFilter[] = [], includeParentheses = false): string {
  const filterClause: string[] = []

  queryItems.forEach((item: IQueryFilter): void => {
    const comparison: SqlComparison = item.comparison
      ? (item.comparison.toUpperCase() as SqlComparison)
      : SqlComparison.Equal
    const operator = item.operator ? item.operator.toUpperCase() : ''

    switch (comparison) {
      case SqlComparison.Between:
      case SqlComparison.NotBetween: {
        filterClause.push(`${item.field} ${comparison} ? AND ?`)
        break
      }
      case SqlComparison.Like:
      case SqlComparison.NotLike: {
        filterClause.push(`${item.field} ${comparison} ?`)
        break
      }
      case SqlComparison.IsNull:
      case SqlComparison.IsNotNull: {
        filterClause.push(`${item.field} ${comparison}`)
        break
      }
      case SqlComparison.In:
      case SqlComparison.NotIn: {
        const values = Array.isArray(item.value1) ? item.value1 : []
        const wildcards = values.map((): string => {
          return '?'
        })
        filterClause.push(`${item.field} ${comparison} (${wildcards.join(',')})`)
        break
      }
      default: {
        filterClause.push(`${item.field} ${comparison} ?`)
        break
      }
    }

    if (operator) {
      filterClause.push(operator)
    }

    if (item.children?.length) {
      filterClause.push(addSelectionFilter(item.children, true))
    }
  })

  return includeParentheses ? `(${filterClause.join(' ')})` : filterClause.join(' ')
}

function addOffset(value: number): string {
  return `OFFSET ${value} ROWS`
}

function addLimit(value: number): string {
  return `FETCH NEXT ${value} ROWS ONLY`
}

function addWhere(queryItems: IQueryFilter[] | undefined): string {
  if (!queryItems?.length) {
    return ''
  }
  return `WHERE ${addSelectionFilter(queryItems)}`
}

function buildUpdate(update: Record<string, unknown>): IParamQuery {
  const setClause = ['SET']
  const parameters: unknown[] = []
  const keys = Object.keys(update).filter((key) => {
    return key !== 'id'
  })

  keys.forEach((key: string, index: number) => {
    parameters.push(update[key])
    const suffix = index < keys.length - 1 ? ',' : ''
    setClause.push(`${key} = ?${suffix}`)
  })

  return {
    statement: setClause.join(' '),
    parameters
  }
}

function getParameters(queryItems: IQueryFilter[] = []): unknown[] {
  let parameters: unknown[] = []

  queryItems.forEach((item: IQueryFilter) => {
    const comparison = item.comparison
      ? (item.comparison.toUpperCase() as SqlComparison)
      : SqlComparison.Equal

    if (comparison === SqlComparison.In || comparison === SqlComparison.NotIn) {
      parameters = parameters.concat(item.value1 as QueryScalar[])
    } else if (comparison !== SqlComparison.IsNull && comparison !== SqlComparison.IsNotNull) {
      parameters.push(item.value1)
    }

    if (isDefined(item.value2)) {
      parameters.push(item.value2)
    }

    if (item.children?.length) {
      parameters = parameters.concat(getParameters(item.children))
    }
  })

  return parameters
}

export class QueryBuilder {
  public static buildCountQuery(queryOptions: IQueryOptions): IParamQuery {
    const statementPieces: string[] = ['SELECT']
    if (queryOptions.isDistinct) {
      statementPieces.push('DISTINCT')
    }
    statementPieces.push('COUNT(*) AS count')
    statementPieces.push(addFrom(queryOptions.tableName))
    statementPieces.push(addWhere(queryOptions.where))

    return {
      statement: numberParams(statementPieces.filter(Boolean).join(' ')),
      parameters: getParameters(queryOptions.where)
    }
  }

  public static buildSelectQuery(queryOptions: IQueryOptions): IParamQuery {
    const statementPieces: string[] = ['SELECT']
    if (queryOptions.isDistinct) {
      statementPieces.push('DISTINCT')
    }
    statementPieces.push(addFields(queryOptions.fields))
    statementPieces.push(addFrom(queryOptions.tableName))
    statementPieces.push(addWhere(queryOptions.where))
    statementPieces.push(addOrderBy(queryOptions))

    if (isDefined(queryOptions.limit)) {
      const offset = queryOptions.offset ?? 0
      statementPieces.push(addOffset(offset))
      statementPieces.push(addLimit(queryOptions.limit!))
    }

    return {
      statement: numberParams(statementPieces.filter(Boolean).join(' ')),
      parameters: getParameters(queryOptions.where)
    }
  }

  public static buildDeleteQuery(queryOptions: IQueryOptions): IParamQuery {
    return {
      statement: numberParams(
        ['DELETE FROM', queryOptions.tableName, addWhere(queryOptions.where)]
          .filter(Boolean)
          .join(' ')
      ),
      parameters: getParameters(queryOptions.where)
    }
  }

  public static buildUpdateQuery(
    queryOptions: IQueryOptions,
    update: Record<string, unknown>
  ): IParamQuery {
    const updateClause = buildUpdate(update)
    return {
      statement: numberParams(
        ['UPDATE', queryOptions.tableName, updateClause.statement, addWhere(queryOptions.where)]
          .filter(Boolean)
          .join(' ')
      ),
      parameters: updateClause.parameters.concat(getParameters(queryOptions.where))
    }
  }
}
