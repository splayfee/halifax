import type { ListOptions } from '@/core/types.js'

/**
 * Converts an array of field names into a Prisma select object.
 * For example, ['id', 'name'] becomes { id: true, name: true }.
 * @param fields An array of field names to select. If undefined or empty, returns undefined to select all fields.
 * @returns A Prisma select object or undefined if no fields are specified.
 */
export function toSelect(fields?: string[]): Record<string, boolean> | undefined {
  if (!fields?.length) return undefined
  return Object.fromEntries(fields.map((f) => [f, true]))
}

/**
 * Converts an array of relation names into a Prisma include object.
 * @param include An array of relation names to include. If undefined or empty, returns undefined to include no relations.
 * @returns A Prisma include object or undefined if no relations are specified.
 */
export function toInclude(include?: string[]): Record<string, boolean> | undefined {
  if (!include?.length) return undefined
  return Object.fromEntries(include.map((r) => [r, true]))
}

/**
 * Converts an array of sort options into a Prisma orderBy object.
 * @param orderBy An array of sort options. If undefined or empty, returns undefined.
 * @returns A Prisma orderBy object or undefined if no sort options are specified.
 */
export function toOrderBy(
  orderBy?: ListOptions['orderBy']
): Array<Record<string, 'asc' | 'desc'>> | undefined {
  if (!orderBy?.length) return undefined
  return orderBy.map((sort) => ({ [sort.field]: sort.direction }))
}

/**
 * Converts a model name into a route prefix by converting it to kebab-case and pluralizing it.
 * @param modelName The name of the model to convert, e.g., 'UserProfile'.
 * @returns The route prefix, e.g., 'user-profiles'.
 */
export function toRoutePrefix(modelName: string): string {
  const kebab = modelName.replace(
    /([A-Z])/g,
    (_match: string, letter: string, offset: number) =>
      (offset > 0 ? '-' : '') + letter.toLowerCase()
  )
  if (kebab.endsWith('y') && !/[aeiou]y$/.test(kebab)) return kebab.slice(0, -1) + 'ies'
  if (/(?:s|x|z|ch|sh)$/.test(kebab)) return kebab + 'es'
  return kebab + 's'
}
