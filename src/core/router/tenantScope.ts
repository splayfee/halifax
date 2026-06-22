import type { AuthContext } from '@/auth/AuthStrategy.js'
import { checkRequiredPermissions } from '@/auth/strategies/types.js'
import { createCachingRepository, type CacheStore } from '@/core/cache/index.js'
import { type CrudAction, type ResourceDefinition } from '@/core/types.js'
import type { HttpRequest, Repository } from '@/core/types.js'
import { wantsCacheBust } from '@/core/handlerUtils.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'
import type { CrudApiOptions, TenantOptions } from './options.js'

/** Matches a safe SQL identifier — tenant fields are interpolated into SQL on bulk paths. */
export const safeIdentifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** Read-only actions that admin bypass applies to. Writes always enforce tenant scoping. */
const READ_ACTIONS = new Set<CrudAction>(['readOne', 'readMany', 'readManyWithQueryBuilder'])

/** Resolves a scoped repository for one request given its caller and action. */
export type ResolveRepo = (
  req: HttpRequest,
  auth: AuthContext,
  action: CrudAction
) => Promise<Repository>

/**
 * Determines the column a resource is tenant-scoped on, with this precedence:
 * explicit `resource.tenant` (or `false` to opt out) → auto-detect the API's default
 * tenant field when the resource actually has it → otherwise unscoped (global).
 */
export function effectiveTenantField(
  resource: ResourceDefinition,
  tenant: TenantOptions | undefined
): string | null {
  if (!tenant) return null
  if (resource.tenant === false) return null
  if (resource.tenant && resource.tenant.field) return resource.tenant.field
  const fallback = tenant.field ?? 'tenantId'
  return (resource.fields ?? []).some((f) => f.name === fallback) ? fallback : null
}

/**
 * Builds the `resolveRepo` closure for a resource — shared by REST and GraphQL route registration
 * so the tenant-scoping and caching logic is defined exactly once. The returned function applies,
 * per request: optional read-through caching, admin read-bypass, and tenant scoping (fail-closed).
 */
export function buildResolveRepo(
  resource: ResourceDefinition,
  repository: Repository,
  tenantField: string | null,
  options: Pick<CrudApiOptions, 'tenant' | 'cache'>,
  cacheStore: CacheStore,
  bustHeader: string
): ResolveRepo {
  const cacheTtl =
    resource.cache === false ? undefined : (resource.cache?.ttlSeconds ?? options.cache?.ttlSeconds)
  const cachingEnabled = cacheTtl !== undefined

  const withCache = (repo: Repository, scopeKey: string, bust: boolean): Repository =>
    cachingEnabled
      ? createCachingRepository(repo, {
          store: cacheStore,
          ttlSeconds: cacheTtl!,
          namespace: `${resource.name}:${scopeKey}`,
          bust
        })
      : repo

  return async (req: HttpRequest, auth: AuthContext, action: CrudAction): Promise<Repository> => {
    const bust = cachingEnabled && wantsCacheBust(req, bustHeader)
    if (!tenantField || !options.tenant) return withCache(repository, 'global', bust)

    const bypassRoles = resource.bypassTenantRoles ?? options.tenant.bypassRoles ?? []
    if (
      READ_ACTIONS.has(action) &&
      bypassRoles.length > 0 &&
      checkRequiredPermissions(auth, bypassRoles)
    ) {
      return withCache(repository, 'global', bust)
    }

    const value = await options.tenant.resolveId({ auth, req, resource })
    if (value === undefined || value === null || value === '') {
      if (options.tenant.strict !== false)
        throw new AuthorizationError('No tenant is associated with this request.')
      return withCache(repository, 'global', bust)
    }
    return withCache(repository.withScope!({ field: tenantField, value }), String(value), bust)
  }
}
