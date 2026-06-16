import type { IQueryFilter, IQueryOptions, QueryScalar } from '@edium/halifax-types'
import type { TenantScope } from '@/core/types.js'

/** Merges the tenant constraint into a Prisma `where` object (scope wins on conflicts). */
export function scopedWhere(
  scope: TenantScope | undefined,
  where?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!scope) return where
  return { ...(where ?? {}), [scope.field]: scope.value }
}

/** Removes the tenant field from a write payload so callers can't reassign tenant ownership. */
export function stripTenant<T>(scope: TenantScope | undefined, data: T): T {
  if (!scope) return data
  if (data === null || typeof data !== 'object') return data
  const copy = { ...(data as Record<string, unknown>) }
  delete copy[scope.field]
  return copy as T
}

/** Stamps the tenant value onto a create payload, overriding any caller-supplied value. */
export function stampTenant<T>(scope: TenantScope | undefined, data: T): T {
  if (!scope) return data
  return { ...(data as Record<string, unknown>), [scope.field]: scope.value } as T
}

/**
 * AND-s the tenant constraint into a query-builder WHERE clause. The caller's filters are
 * nested beneath the tenant condition so a caller-supplied `OR` can't escape the tenant
 * boundary once the AST is compiled.
 */
export function scopedFilters(
  scope: TenantScope | undefined,
  where?: IQueryFilter[]
): IQueryFilter[] | undefined {
  if (!scope) return where
  const tenantNode: IQueryFilter = {
    field: scope.field,
    comparison: '=',
    value1: scope.value as QueryScalar
  }
  if (where?.length) {
    tenantNode.operator = 'AND'
    tenantNode.children = where
  }
  return [tenantNode]
}

/** Applies the tenant scope to a query-builder AST via {@link scopedFilters}. */
export function resolveScopedQuery(
  scope: TenantScope | undefined,
  query: IQueryOptions
): IQueryOptions {
  const resolved: IQueryOptions = { ...query }
  const where = scopedFilters(scope, query.where)
  if (where) resolved.where = where
  return resolved
}
