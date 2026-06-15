import type { FieldDefinition, ResourceDefinition } from '@/core/types.js'

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
