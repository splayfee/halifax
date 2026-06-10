import { SqlComparison } from '@/enums/SqlComparison.js'
import { SqlOperator } from '@/enums/SqlOperator.js'
import { SqlOrder } from '@/enums/SqlOrder.js'
import { PayloadError } from '@/errors/PayloadError.js'
import type { IQueryFilter } from '@/interfaces/IQueryFilter.js'
import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'
import type { ResourceDefinition } from '@/core/types.js'

const reservedQueryStringProperties = ['fields', 'limit', 'offset', 'order', 'include']

export function isValidInt32(value: string | number | null, min = 1): boolean {
  if (value === null || value === undefined) {
    return false
  }
  const normalized = typeof value === 'string' ? Number(value.trim()) : value
  return Number.isSafeInteger(normalized) && normalized >= min && normalized <= 2147483647
}

export function validateId(value: string | number | undefined): asserts value is string | number {
  if (value === undefined || !isValidInt32(value)) {
    throw new PayloadError('Id parameter must be an integer from 1 to 2147483647.')
  }
}

export function getFieldNames(resource: ResourceDefinition): string[] {
  return resource.fields.map((field) => {
    return field.name
  })
}

export function validateFields(resource: ResourceDefinition, fields: string[] = []): void {
  const validFields = new Set(getFieldNames(resource))
  const invalidFields = fields.filter((field) => {
    return !validFields.has(field)
  })

  if (invalidFields.length) {
    throw new PayloadError(`Invalid field(s): ${invalidFields.join(', ')}.`)
  }
}

export function validateIncludes(resource: ResourceDefinition, includes: string[] = []): void {
  const validIncludes = new Set(
    (resource.relations ?? [])
      .filter((relation) => {
        return relation.includable !== false
      })
      .map((relation) => {
        return relation.name
      })
  )

  const invalidIncludes = includes.filter((include) => {
    return !validIncludes.has(include)
  })

  if (invalidIncludes.length) {
    throw new PayloadError(`Invalid include(s): ${invalidIncludes.join(', ')}.`)
  }
}

export function validateQueryString(
  resource: ResourceDefinition,
  query: Record<string, unknown>
): void {
  const validProps = new Set([...getFieldNames(resource), ...reservedQueryStringProperties])
  const invalidProps = Object.keys(query).filter((property) => {
    return !validProps.has(property)
  })

  if (invalidProps.length) {
    throw new PayloadError(`Invalid query-string properties: ${invalidProps.join(', ')}.`)
  }
}

export function validateWhere(resource: ResourceDefinition, where: IQueryFilter[] = []): void {
  const validComparisons = new Set(Object.values(SqlComparison))
  const validOperators = new Set(Object.values(SqlOperator))

  where.forEach((filter, index) => {
    if (!filter.field) {
      throw new PayloadError('WHERE clause must have a field.')
    }

    validateFields(resource, [filter.field])

    const comparison = filter.comparison?.toUpperCase() as SqlComparison
    if (!comparison || !validComparisons.has(comparison)) {
      throw new PayloadError(`Invalid comparison: '${filter.comparison}'.`)
    }

    const operator = filter.operator?.toUpperCase() as SqlOperator | undefined
    if (operator && !validOperators.has(operator)) {
      throw new PayloadError(`Invalid operator: '${filter.operator}'.`)
    }

    if (index + 1 < where.length && !operator) {
      throw new PayloadError('Operator is required for all but the last item in the WHERE clause.')
    }

    if (filter.children?.length) {
      validateWhere(resource, filter.children)
    }
  })
}

export function validateAdvancedQuery(resource: ResourceDefinition, query: IQueryOptions): void {
  if (query.fields) {
    validateFields(resource, query.fields)
  }

  if (query.orderBy) {
    const validOrders = new Set(Object.values(SqlOrder))
    query.orderBy.forEach((sort) => {
      validateFields(resource, [sort.field])
      if (!validOrders.has(sort.order.toUpperCase() as SqlOrder)) {
        throw new PayloadError(`Invalid sort order: '${sort.order}'.`)
      }
    })
  }

  validateWhere(resource, query.where)
}
