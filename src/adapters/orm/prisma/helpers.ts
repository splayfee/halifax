import type { ListOptions } from '@/core/repository.js'

export function toSelect(fields?: string[]): Record<string, boolean> | undefined {
  if (!fields?.length) return undefined
  return Object.fromEntries(fields.map((f) => [f, true]))
}

export function toInclude(include?: string[]): Record<string, boolean> | undefined {
  if (!include?.length) return undefined
  return Object.fromEntries(include.map((r) => [r, true]))
}

export function toOrderBy(
  orderBy?: ListOptions['orderBy']
): Array<Record<string, 'asc' | 'desc'>> | undefined {
  if (!orderBy?.length) return undefined
  return orderBy.map((sort) => ({ [sort.field]: sort.direction }))
}

export function toRoutePrefix(modelName: string): string {
  const kebab = modelName.replace(/([A-Z])/g, (m, l, i) => (i > 0 ? '-' : '') + l.toLowerCase())
  if (kebab.endsWith('y') && !/[aeiou]y$/.test(kebab)) return kebab.slice(0, -1) + 'ies'
  if (/(?:s|x|z|ch|sh)$/.test(kebab)) return kebab + 'es'
  return kebab + 's'
}
