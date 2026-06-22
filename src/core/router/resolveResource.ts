import type { FieldDefinition, ResourceDefinition } from '@/core/types.js'
import { toTitleCase } from '@/core/stringUtils.js'
import { mergeFieldDefinitions, mergeRelationDefinitions } from '@/core/fields.js'
import { ServerError } from '@/errors/ServerError.js'

/**
 * Resolves the effective field list for a resource. Merges the repository's field schema
 * with the resource's own `fields` as sparse overrides. Applies permissive defaults for all
 * flags except the primary key, which is non-writable unless explicitly opted in.
 * @throws {@link ServerError} when neither the repository nor the resource provides any fields.
 */
function resolveFields(resource: ResourceDefinition, idField: string): FieldDefinition[] {
  const merged = mergeFieldDefinitions(resource)
  if (merged.length === 0) {
    throw new ServerError(
      `Resource '${resource.name ?? resource.routePrefix}' has no fields. Provide 'fields', ` +
        `or construct its repository with a model so the schema can be derived.`
    )
  }

  return merged.map((field) => ({
    name: field.name,
    filterable: field.filterable !== false,
    sortable: field.sortable !== false,
    selectable: field.selectable !== false,
    // Permissive by default — but the primary key is protected: writable only when opted in.
    writable: field.name === idField ? field.writable === true : field.writable !== false,
    ...(field.type !== undefined ? { type: field.type } : {}),
    ...(field.format !== undefined ? { format: field.format } : {}),
    ...(field.readRoles?.length ? { readRoles: field.readRoles } : {}),
    ...(field.writeRoles?.length ? { writeRoles: field.writeRoles } : {})
  }))
}

/**
 * Produces a fully-resolved resource: `name` filled in, and `fields`/`relations` resolved
 * from the repository schema + the resource's own entries. Every downstream stage operates
 * on this normalized form so defaults live in exactly one place.
 */
export function normalizeResource(resource: ResourceDefinition): ResourceDefinition {
  const idField = resource.repository?.idField ?? 'id'
  return {
    ...resource,
    name: resource.name ?? toTitleCase(resource.routePrefix),
    fields: resolveFields(resource, idField),
    relations: mergeRelationDefinitions(resource)
  }
}
