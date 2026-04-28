import { SqlOrder } from '@/enums/SqlOrder.js'
import { PayloadError } from '@/errors/PayloadError.js'
import type { ListOptions, ResourceDefinition } from '@/core/types.js'
import { isValidInt32, validateFields, validateIncludes, validateQueryString } from '@/core/validation.js'

function parseInteger(value: unknown, property: string, min = 1): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(Array.isArray(value) ? value[0] : value)
  if (isValidInt32(parsed, min)) return parsed
  throw new PayloadError(`${property} must be a valid integer greater than or equal to ${min}.`)
}

function parseCsv(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value.join(',') : value
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  return raw.split(',').map((item) => item.trim()).filter(Boolean)
}

export function parseListOptions(query: Record<string, unknown>, resource: ResourceDefinition): ListOptions {
  validateQueryString(resource, query)

  const fields = parseCsv(query.fields)
  const include = parseCsv(query.include)
  const limit = parseInteger(query.limit, 'limit')
  const offset = parseInteger(query.offset, 'offset', 0)
  const order = parseCsv(query.order)

  if (fields) validateFields(resource, fields)
  if (include) validateIncludes(resource, include)

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
      if (item.startsWith('-')) return { field: item.substring(1), direction: SqlOrder.DESC.toLowerCase() as 'desc' }
      return { field: item, direction: SqlOrder.ASC.toLowerCase() as 'asc' }
    })
  }
}
