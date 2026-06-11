import { validate as uuidValidate } from 'uuid'
import { SqlComparison } from '@/enums/SqlComparison.js'
import { SqlOperator } from '@/enums/SqlOperator.js'
import { SqlOrder } from '@/enums/SqlOrder.js'
import { BadRequestError } from '@/errors/BadRequestError.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'
import type { IQueryFilter } from '@/interfaces/IQueryFilter.js'
import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'
import type { ResourceDefinition } from '@/core/types.js'

const reservedQueryStringProperties = ['fields', 'limit', 'offset', 'order', 'include']

/**
 * Returns `true` when `value` is a safe 32-bit integer >= `min`.
 * @param value - Raw value to test (string or number).
 * @param min - Inclusive lower bound (default: `1`).
 * @returns `true` when value is a valid integer within the 32-bit range and >= min.
 */
export function isValidInt32(value: string | number | null, min = 1): boolean {
  if (value === null || value === undefined) {
    return false
  }
  const normalized = typeof value === 'string' ? Number(value.trim()) : value
  return Number.isSafeInteger(normalized) && normalized >= min && normalized <= 2147483647
}

/**
 * Returns `true` when `value` is a valid RFC 4122 UUID.
 * @param value - String to test.
 * @returns `true` when `value` matches the UUID format.
 */
export function isValidUuid(value: string): boolean {
  return uuidValidate(value)
}

/**
 * Asserts that `value` is a valid integer ID or UUID string.
 * Throws {@link BadRequestError} when validation fails.
 * @param value - Raw `:id` route parameter to validate.
 */
export function validateId(value: string | number | undefined): asserts value is string | number {
  if (value === undefined) {
    throw new BadRequestError('Id parameter must be an integer (1–2147483647) or a valid UUID.')
  }
  const isInt = isValidInt32(value)
  const isUuid = typeof value === 'string' && isValidUuid(value)
  if (!isInt && !isUuid) {
    throw new BadRequestError('Id parameter must be an integer (1–2147483647) or a valid UUID.')
  }
}

/**
 * Returns the list of field names defined on a resource.
 * @param resource - The resource definition to extract field names from.
 * @returns Array of field name strings.
 */
export function getFieldNames(resource: ResourceDefinition): string[] {
  return resource.fields.map((field) => {
    return field.name
  })
}

/**
 * Throws {@link UnprocessableEntityError} when any of `fields` are not defined on the resource.
 * @param resource - The resource definition to validate against.
 * @param fields - Field names to validate (empty array is a no-op).
 */
export function validateFields(resource: ResourceDefinition, fields: string[] = []): void {
  const validFields = new Set(getFieldNames(resource))
  const invalidFields = fields.filter((field) => {
    return !validFields.has(field)
  })

  if (invalidFields.length) {
    throw new UnprocessableEntityError(`Invalid field(s): ${invalidFields.join(', ')}.`)
  }
}

/**
 * Throws {@link UnprocessableEntityError} when any of `fields` have `selectable: false`.
 * @param resource - The resource definition to validate against.
 * @param fields - Field names to check for selectability.
 */
export function validateSelectableFields(resource: ResourceDefinition, fields: string[]): void {
  const nonSelectable = fields.filter((name) => {
    const field = resource.fields.find((f) => f.name === name)
    return field?.selectable === false
  })
  if (nonSelectable.length) {
    throw new UnprocessableEntityError(`Field(s) not selectable: ${nonSelectable.join(', ')}.`)
  }
}

/**
 * Throws {@link UnprocessableEntityError} when any of `fields` have `sortable: false`.
 * @param resource - The resource definition to validate against.
 * @param fields - Field names to check for sortability.
 */
export function validateSortableFields(resource: ResourceDefinition, fields: string[]): void {
  const nonSortable = fields.filter((name) => {
    const field = resource.fields.find((f) => f.name === name)
    return field?.sortable === false
  })
  if (nonSortable.length) {
    throw new UnprocessableEntityError(`Field(s) not sortable: ${nonSortable.join(', ')}.`)
  }
}

/**
 * Throws {@link UnprocessableEntityError} when any of `includes` reference non-includable relations.
 * @param resource - The resource definition whose relations are checked.
 * @param includes - Relation names to validate.
 */
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
    throw new UnprocessableEntityError(`Invalid include(s): ${invalidIncludes.join(', ')}.`)
  }
}

/**
 * Validates that every query-string key is either a reserved parameter or a filterable field.
 * Throws {@link UnprocessableEntityError} for non-filterable fields or unknown properties.
 * @param resource - The resource definition whose fields are checked.
 * @param query - The raw query-string object from the HTTP request.
 */
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
    throw new UnprocessableEntityError(`Field(s) not filterable: ${nonFilterable.join(', ')}.`)
  }
  if (unknown.length) {
    throw new UnprocessableEntityError(`Invalid query-string properties: ${unknown.join(', ')}.`)
  }
}

/**
 * Validates a WHERE clause filter tree against the resource's field definitions.
 * Throws {@link UnprocessableEntityError} on invalid fields, comparisons, operators, or exceeded nesting depth.
 * @param resource - The resource definition whose fields and depth limit are used.
 * @param where - Array of filter conditions to validate.
 * @param depth - Current recursion depth (used for nesting-limit enforcement; start at `0`).
 */
export function validateWhere(
  resource: ResourceDefinition,
  where: IQueryFilter[] = [],
  depth = 0
): void {
  const maxDepth = resource.maxFilterDepth ?? 4
  if (depth > maxDepth) {
    throw new UnprocessableEntityError(
      `Filter nesting exceeds the maximum allowed depth of ${maxDepth}.`
    )
  }

  const validComparisons = new Set(Object.values(SqlComparison))
  const validOperators = new Set(Object.values(SqlOperator))

  where.forEach((filter, index) => {
    if (!filter.field) {
      throw new UnprocessableEntityError('WHERE clause must have a field.')
    }

    validateFields(resource, [filter.field])

    const comparison = filter.comparison?.toUpperCase() as SqlComparison
    if (!comparison || !validComparisons.has(comparison)) {
      throw new UnprocessableEntityError(`Invalid comparison: '${filter.comparison}'.`)
    }

    const operator = filter.operator?.toUpperCase() as SqlOperator | undefined
    if (operator && !validOperators.has(operator)) {
      throw new UnprocessableEntityError(`Invalid operator: '${filter.operator}'.`)
    }

    if (index + 1 < where.length && !operator) {
      throw new UnprocessableEntityError(
        'Operator is required for all but the last item in the WHERE clause.'
      )
    }

    if (filter.children?.length) {
      validateWhere(resource, filter.children, depth + 1)
    }
  })
}

/**
 * Validates a full query-builder AST (fields, orderBy, where) against the resource's schema.
 * Throws {@link UnprocessableEntityError} on any invalid input.
 * @param resource - The resource definition used for field and relation validation.
 * @param query - The query AST to validate.
 */
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
        throw new UnprocessableEntityError(`Invalid sort order: '${sort.order}'.`)
      }
    })
  }

  validateWhere(resource, query.where)
}
