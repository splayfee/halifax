import { SqlOrder } from '@/enums/SqlOrder.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'
import type { ListOptions, ResourceDefinition } from '@/core/types.js'
import {
  isValidInt32,
  validateFields,
  validateIncludes,
  validateQueryString,
  validateSelectableFields,
  validateSortableFields
} from '@/core/validation.js'

/**
 * Parses and validates a single integer query-string value.
 * @param value - Raw query-string value (string, number, or array).
 * @param property - Parameter name used in the error message (e.g. `'limit'`).
 * @param min - Inclusive lower bound (default: `1`).
 * @returns The parsed integer, or `undefined` when `value` is absent.
 */
function parseInteger(value: unknown, property: string, min = 1): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(Array.isArray(value) ? value[0] : value)
  if (isValidInt32(parsed, min)) return parsed
  throw new UnprocessableEntityError(
    `${property} must be a valid integer greater than or equal to ${min}.`
  )
}

/**
 * Splits a comma-separated string (or array) into a trimmed, non-empty string array.
 * @param value - Raw query-string value to parse.
 * @returns Array of trimmed strings, or `undefined` when the input is blank or absent.
 */
function parseCsv(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value.join(',') : value
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Parses and validates the raw query-string from a GET request into typed {@link ListOptions}.
 *
 * Validates field names, sort fields, includes, and filter keys against the resource schema.
 * Applies `defaultLimit` and `maxLimit` from the resource definition when set.
 *
 * @param query - The raw query-string object from the HTTP request.
 * @param resource - The resource definition used for field and relation validation.
 * @returns Typed list options ready to pass to `repository.getMany()`.
 */
export function parseListOptions(
  query: Record<string, unknown>,
  resource: ResourceDefinition
): ListOptions {
  validateQueryString(resource, query)

  const fields = parseCsv(query.fields)
  const include = parseCsv(query.include)
  let limit = parseInteger(query.limit, 'limit')
  const offset = parseInteger(query.offset, 'offset', 0)
  const order = parseCsv(query.order)

  if (!limit && resource.defaultLimit) limit = resource.defaultLimit
  if (limit && resource.maxLimit && limit > resource.maxLimit) limit = resource.maxLimit

  if (fields) {
    validateFields(resource, fields)
    validateSelectableFields(resource, fields)
  }
  if (include) validateIncludes(resource, include)
  if (fields && include) {
    throw new UnprocessableEntityError(
      'Cannot use both ?fields= and ?include= in the same request.'
    )
  }

  const orderFields = order?.map((item) => (item.startsWith('-') ? item.substring(1) : item))
  if (orderFields?.length) {
    validateFields(resource, orderFields)
    validateSortableFields(resource, orderFields)
  }

  const where: Record<string, unknown> = {}
  const fieldNames = new Set(resource.fields.map((field) => field.name))

  Object.entries(query).forEach(([key, value]) => {
    if (!fieldNames.has(key)) return
    const normalized = Array.isArray(value) ? value : String(value).split(',')
    where[key] = normalized.length === 1 ? normalized[0] : { in: normalized }
  })

  return {
    fields,
    include,
    limit,
    offset,
    where,
    orderBy: order?.map((item) => {
      if (item.startsWith('-'))
        return { field: item.substring(1), direction: SqlOrder.DESC.toLowerCase() as 'desc' }
      return { field: item, direction: SqlOrder.ASC.toLowerCase() as 'asc' }
    })
  }
}
