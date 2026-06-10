import { validate as uuidValidate } from 'uuid'
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

export function isValidUuid(value: string): boolean {
  return uuidValidate(value)
}

export function validateId(value: string | number | undefined): asserts value is string | number {
  if (value === undefined) {
    throw new PayloadError('Id parameter must be an integer (1–2147483647) or a valid UUID.')
  }
  const isInt = isValidInt32(value)
  const isUuid = typeof value === 'string' && isValidUuid(value)
  if (!isInt && !isUuid) {
    throw new PayloadError('Id parameter must be an integer (1–2147483647) or a valid UUID.')
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

export function validateSelectableFields(resource: ResourceDefinition, fields: string[]): void {
  const nonSelectable = fields.filter((name) => {
    const field = resource.fields.find((f) => f.name === name)
    return field?.selectable === false
  })
  if (nonSelectable.length) {
    throw new PayloadError(`Field(s) not selectable: ${nonSelectable.join(', ')}.`)
  }
}

export function validateSortableFields(resource: ResourceDefinition, fields: string[]): void {
  const nonSortable = fields.filter((name) => {
    const field = resource.fields.find((f) => f.name === name)
    return field?.sortable === false
  })
  if (nonSortable.length) {
    throw new PayloadError(`Field(s) not sortable: ${nonSortable.join(', ')}.`)
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
  const filterableFieldNames = resource.fields
    .filter((f) => f.filterable !== false)
    .map((f) => f.name)
  const allFieldNames = new Set(getFieldNames(resource))
  const validProps = new Set([...filterableFieldNames, ...reservedQueryStringProperties])

  const nonFilterable: string[] = []
  const unknown: string[] = []

  for (const prop of Object.keys(query)) {
    if (!validProps.has(prop)) {
      if (allFieldNames.has(prop)) {
        nonFilterable.push(prop)
      } else {
        unknown.push(prop)
      }
    }
  }

  if (nonFilterable.length) {
    throw new PayloadError(`Field(s) not filterable: ${nonFilterable.join(', ')}.`)
  }
  if (unknown.length) {
    throw new PayloadError(`Invalid query-string properties: ${unknown.join(', ')}.`)
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
    validateSelectableFields(resource, query.fields)
  }

  if (query.orderBy) {
    const validOrders = new Set(Object.values(SqlOrder))
    const sortFields = query.orderBy.map((s) => s.field)
    validateFields(resource, sortFields)
    validateSortableFields(resource, sortFields)
    query.orderBy.forEach((sort) => {
      if (!validOrders.has(sort.order.toUpperCase() as SqlOrder)) {
        throw new PayloadError(`Invalid sort order: '${sort.order}'.`)
      }
    })
  }

  validateWhere(resource, query.where)
}
