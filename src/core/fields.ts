import type { FieldDefinition, RelationDefinition, ResourceDefinition } from '@/core/types.js'

/**
 * Merges a resource's field schema: repository fields are the base, and
 * `resource.fields` entries are applied as sparse overrides (by name).
 * Returns the raw merged list with no defaults applied — callers normalise
 * the flags they care about on top of this.
 */
export function mergeFieldDefinitions(resource: ResourceDefinition): FieldDefinition[] {
  const byName = new Map<string, FieldDefinition>()
  for (const f of resource.repository?.fields ?? []) byName.set(f.name, { ...f })
  for (const f of resource.fields ?? []) byName.set(f.name, { ...byName.get(f.name), ...f })
  return [...byName.values()]
}

/**
 * Merges a resource's relation schema: repository relations are the base, and
 * `resource.relations` entries are applied as sparse overrides (by name).
 */
export function mergeRelationDefinitions(resource: ResourceDefinition): RelationDefinition[] {
  const byName = new Map<string, RelationDefinition>()
  for (const r of resource.repository?.relations ?? []) byName.set(r.name, r)
  for (const r of resource.relations ?? []) byName.set(r.name, r)
  return [...byName.values()]
}

/**
 * Resolves the effective envelope key. A non-empty string enables wrapping;
 * `null`, `undefined`, and `''` all mean "no envelope".
 */
export function normalizeEnvelope(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
