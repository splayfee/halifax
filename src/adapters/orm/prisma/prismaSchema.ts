import type { FieldDefinition, ModelSchema, RelationDefinition } from '@/core/types.js'
import { prismaTypeToOpenApi } from './prismaUtils.js'

/**
 * Derives Halifax {@link FieldDefinition}s from a Prisma model schema — one per scalar/enum field
 * (relation/object fields are excluded; those become relations). The primary key and read-only
 * columns are marked non-writable; everything else is filterable, sortable, and writable, with the
 * OpenAPI `type`/`format` inferred from the Prisma scalar type.
 */
export function fieldsFromModel(model: ModelSchema): FieldDefinition[] {
  return model.fields
    .filter((f) => f.kind !== 'object')
    .map((f) => ({
      name: f.name,
      filterable: true,
      sortable: true,
      writable: !f.isId && !f.isReadOnly,
      ...prismaTypeToOpenApi(f.type)
    }))
}

/**
 * Derives Halifax {@link RelationDefinition}s from a Prisma model schema — one per object
 * (relation) field, each includable via `?include=`.
 */
export function relationsFromModel(model: ModelSchema): RelationDefinition[] {
  return model.fields
    .filter((f) => f.kind === 'object')
    .map((f) => ({ name: f.name, includable: true }))
}
