import type { AuthContext } from '@/auth/AuthStrategy.js'
import type { ResourceDefinition } from '@/core/types.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'

/**
 * Strips non-writable fields from a request body and rejects unknown fields with a 422.
 * Fields with `writable: false` are dropped; fields gated by `writeRoles` the caller lacks
 * are also dropped.
 *
 * Generic in the payload type so callers preserve it: given a `TCreate`/`TUpdate` body the
 * result is typed `Partial<T>` (every field is potentially stripped), letting the repository's
 * typed write methods accept it without an `as never` cast.
 *
 * @throws {@link UnprocessableEntityError} for keys not defined on the resource.
 */
export function filterWritableFields<T extends Record<string, unknown>>(
  resource: ResourceDefinition,
  data: T,
  auth?: AuthContext
): Partial<T> {
  const fields = resource.fields ?? []
  const fieldMap = new Map(fields.map((f) => [f.name, f]))
  const unknownFields = Object.keys(data).filter((key) => !fieldMap.has(key))
  if (unknownFields.length) {
    throw new UnprocessableEntityError(`Unknown field(s): ${unknownFields.join(', ')}.`)
  }

  const userRoles = new Set([...(auth?.roles ?? []), ...(auth?.permissions ?? [])])

  return Object.fromEntries(
    Object.entries(data).filter(([key]) => {
      const field = fieldMap.get(key)
      if (field?.writable === false) return false
      if (field?.writeRoles?.length) {
        return field.writeRoles.some((r) => userRoles.has(r))
      }
      return true
    })
  ) as Partial<T>
}

/**
 * Strips fields the caller is not permitted to read based on per-field `readRoles`.
 * Fast-path returns the record unchanged when no fields carry read restrictions.
 */
export function filterReadableFields(
  resource: ResourceDefinition,
  record: Record<string, unknown>,
  auth?: AuthContext
): Record<string, unknown> {
  return makeReadableFieldFilter(resource, auth)(record)
}

/**
 * Returns a reusable filter function that strips read-restricted fields.
 * Build this once per request (outside a `.map()` loop) so the fieldMap and
 * userRoles Set are not reconstructed for every record in a bulk response.
 */
export function makeReadableFieldFilter(
  resource: ResourceDefinition,
  auth?: AuthContext
): (record: Record<string, unknown>) => Record<string, unknown> {
  const fields = resource.fields ?? []
  if (!fields.some((f) => (f.readRoles?.length ?? 0) > 0)) return (r) => r

  const fieldMap = new Map(fields.map((f) => [f.name, f]))
  const userRoles = new Set([...(auth?.roles ?? []), ...(auth?.permissions ?? [])])
  return (record) =>
    Object.fromEntries(
      Object.entries(record).filter(([key]) => {
        const field = fieldMap.get(key)
        if (!field?.readRoles?.length) return true
        return field.readRoles.some((r) => userRoles.has(r))
      })
    )
}
