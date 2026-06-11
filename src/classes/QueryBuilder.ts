import { SqlComparison } from '@/enums/SqlComparison.js'
import { BadRequestError } from '@/errors/BadRequestError.js'
import type { IParamQuery } from '@/interfaces/IParamQuery.js'
import type { IQueryFilter, QueryScalar } from '@/interfaces/IQueryFilter.js'
import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'
import type { ISort } from '@/interfaces/ISort.js'

/**
 * Returns `true` when `value` is neither `undefined` nor `null`.
 * @param value - Value to test.
 * @returns `true` when `value` is defined and not null.
 */
function isDefined(value: unknown): boolean {
  return value !== undefined && value !== null
}

/**
 * Replaces `?` placeholder markers with PostgreSQL-style `$1`, `$2`, … numbered parameters.
 * @param statement - SQL string containing `?` placeholders.
 * @returns The same SQL string with `?` replaced by `$1`, `$2`, etc. in order.
 */
function numberParams(statement: string): string {
  let i = 0
  return statement.replace(/\?/g, () => `$${++i}`)
}

/**
 * Returns the SELECT field list, or `*` when no fields are specified.
 * @param fields - Array of column names to include, or `undefined` for all columns.
 * @returns A comma-separated field list, or `'*'`.
 */
function addFields(fields: string[] | undefined): string {
  return fields?.length ? fields.join(',') : '*'
}

/**
 * Returns the `FROM <tableName>` clause.
 * @param tableName - Target table name.
 * @returns A `FROM <tableName>` SQL fragment.
 * @throws {@link BadRequestError} when `tableName` is absent.
 */
function addFrom(tableName?: string): string {
  if (!tableName) {
    throw new BadRequestError('The query builder requires a table name.')
  }
  return `FROM ${tableName}`
}

/**
 * Returns the `ORDER BY` clause from the query options, or an empty string when no sorts are given.
 * @param queryOptions - Query AST whose `orderBy` array is used.
 * @returns An `ORDER BY ...` SQL fragment, or `''` when `orderBy` is absent or empty.
 */
function addOrderBy(queryOptions: IQueryOptions): string {
  const order: ISort[] = queryOptions.orderBy ?? []
  const orderClauses = order.map((sort: ISort) => `${sort.field} ${sort.order}`)
  if (orderClauses.length === 0) return ''
  return `ORDER BY ${orderClauses.join(',')}`
}

/**
 * Builds the filter clause fragment for a list of {@link IQueryFilter} conditions.
 * @param queryItems - Filter conditions to convert into SQL.
 * @param includeParentheses - When `true`, wraps the result in parentheses (used for child groups).
 * @returns A SQL fragment representing all conditions joined by their operators.
 */
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

/**
 * Returns an `OFFSET <value> ROWS` SQL fragment.
 * @param value - Number of rows to skip.
 * @returns The OFFSET clause string.
 */
function addOffset(value: number): string {
  return `OFFSET ${value} ROWS`
}

/**
 * Returns a `FETCH NEXT <value> ROWS ONLY` SQL fragment.
 * @param value - Maximum number of rows to return.
 * @returns The FETCH clause string.
 */
function addLimit(value: number): string {
  return `FETCH NEXT ${value} ROWS ONLY`
}

/**
 * Returns a `WHERE ...` clause, or an empty string when there are no filters.
 * @param queryItems - Array of filter conditions, or `undefined`.
 * @returns A `WHERE ...` SQL fragment, or `''` when `queryItems` is empty.
 */
function addWhere(queryItems: IQueryFilter[] | undefined): string {
  if (!queryItems?.length) {
    return ''
  }
  return `WHERE ${addSelectionFilter(queryItems)}`
}

/**
 * Builds a `SET col = ?, ...` fragment and collects the corresponding parameter values.
 * The `id` column is automatically excluded from the SET clause.
 * @param update - Key-value pairs to assign (the `id` key is skipped).
 * @returns A parameterised SET clause and its ordered bind values.
 */
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

/**
 * Recursively extracts the ordered list of bind parameters from a filter tree.
 * @param queryItems - Array of filter conditions to extract parameters from.
 * @returns Flat array of bind values in the same order as the `?` placeholders in the SQL.
 */
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

/** Generates parameterised PostgreSQL SQL statements from a query-builder AST. */
export class QueryBuilder {
  /**
   * Builds a `SELECT COUNT(*) AS count FROM …` query.
   * @param queryOptions - Query AST including table name and optional WHERE clause.
   * @returns A parameterised SQL statement and its bind values, ready to execute.
   */
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

  /**
   * Builds a `SELECT … FROM … WHERE … ORDER BY … OFFSET … FETCH NEXT …` query.
   * @param queryOptions - Full query AST including fields, pagination, sorting, and filters.
   * @returns A parameterised SQL statement and its bind values, ready to execute.
   */
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

  /**
   * Builds a `DELETE FROM … WHERE …` query.
   * @param queryOptions - Query AST including table name and WHERE clause.
   * @returns A parameterised SQL statement and its bind values, ready to execute.
   */
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

  /**
   * Builds an `UPDATE … SET … WHERE …` query.
   * @param queryOptions - Query AST including table name and WHERE clause.
   * @param update - Key-value pairs to assign in the SET clause (`id` is excluded automatically).
   * @returns A parameterised SQL statement and its bind values, ready to execute.
   */
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
