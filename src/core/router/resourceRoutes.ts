import type { AuthStrategy } from '@/auth/AuthStrategy.js'
import type { CacheStore } from '@/core/cache/index.js'
import type { CrudHooks } from '@/core/hooks.js'
import {
  defaultCrudPermissions,
  type CrudPermissions,
  type ResourceDefinition
} from '@/core/types.js'
import { normalizeEnvelope } from '@/core/fields.js'
import { type RouteHandlerContext } from '@/core/handlerUtils.js'
import { sendError } from '@/core/errorUtils.js'
import { ServerError } from '@/errors/ServerError.js'
import { MethodNotAllowedError } from '@/errors/MethodNotAllowedError.js'
import { registerCreate } from '@/core/handlers/create.js'
import { registerReadMany } from '@/core/handlers/readMany.js'
import { registerReadOne } from '@/core/handlers/readOne.js'
import { registerQuery } from '@/core/handlers/query.js'
import { registerUpdateOne } from '@/core/handlers/updateOne.js'
import { registerUpdateMany } from '@/core/handlers/updateMany.js'
import { registerUpsertOne } from '@/core/handlers/upsertOne.js'
import { registerDeleteOne } from '@/core/handlers/deleteOne.js'
import { registerDeleteMany } from '@/core/handlers/deleteMany.js'
import { normalizeResource } from './resolveResource.js'
import { buildResolveRepo, effectiveTenantField, safeIdentifier } from './tenantScope.js'
import type { GqlCtx } from './graphqlRoutes.js'
import type { CrudApiOptions } from './options.js'
import type { TrackingHttpServer } from './trackingHttpServer.js'

/** A resource with all defaults resolved and its per-request contexts built, ready to register. */
export interface PreparedResource {
  resource: ResourceDefinition
  permissions: Required<CrudPermissions>
  basePath: string
  handlerCtx: RouteHandlerContext
  gqlCtx: GqlCtx
}

/**
 * Resolves a raw resource into a {@link PreparedResource}: validates the repository, normalizes
 * fields/relations, computes the effective envelope, resolves and validates tenant scoping
 * (fail-closed on misconfiguration), and builds the shared `resolveRepo` + handler/GraphQL contexts.
 * @throws {@link ServerError} when the repository is missing, the tenant field is unsafe, or a
 *   tenant-scoped repository can't be scoped.
 */
export function prepareResource(
  rawResource: ResourceDefinition,
  options: CrudApiOptions,
  authStrategy: AuthStrategy,
  cacheStore: CacheStore,
  bustHeader: string
): PreparedResource {
  const repository = rawResource.repository
  if (!repository)
    throw new ServerError(
      `Resource '${rawResource.name ?? rawResource.routePrefix}' does not define a repository.`
    )

  // Resolve name + field/relation schema once so every downstream stage works off a single
  // source of truth with all defaults already applied.
  const resource = normalizeResource(rawResource)

  // Per-resource envelope wins over API-wide default, including an explicit null/''.
  const envelope = normalizeEnvelope(
    resource.envelope !== undefined ? resource.envelope : options.envelope
  )

  // Resolve tenancy once at registration and fail closed on misconfiguration.
  const tenantField = effectiveTenantField(resource, options.tenant)
  if (tenantField) {
    if (!safeIdentifier.test(tenantField))
      throw new ServerError(
        `Resource '${resource.name}' has an unsafe tenant field name '${tenantField}'.`
      )
    if (!repository.withScope)
      throw new ServerError(
        `Resource '${resource.name}' is tenant-scoped on '${tenantField}' but its repository ` +
          `does not implement withScope(). Refusing to serve it unscoped.`
      )
  }

  const resolveRepo = buildResolveRepo(
    resource,
    repository,
    tenantField,
    options,
    cacheStore,
    bustHeader
  )
  // Cast to the widest usable type once so every handler can call hooks without generics.
  const hooks = resource.hooks as
    | CrudHooks<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>
    | undefined

  return {
    resource,
    permissions: { ...defaultCrudPermissions, ...resource.permissions },
    basePath: `/${resource.routePrefix}`,
    handlerCtx: { resource, authStrategy, envelope, hooks, resolveRepo },
    gqlCtx: { resource, hooks, resolveRepo }
  }
}

/** Registers each enabled CRUD verb handler for a prepared resource. */
function registerCrudHandlers(
  tracker: TrackingHttpServer,
  prepared: PreparedResource,
  queryBuilderPath: string
): void {
  const { permissions, basePath, handlerCtx } = prepared
  if (permissions.allowCreate) registerCreate(tracker, basePath, handlerCtx)
  if (permissions.allowReadMany) registerReadMany(tracker, basePath, handlerCtx)
  if (permissions.allowReadManyWithQueryBuilder)
    registerQuery(tracker, basePath, queryBuilderPath, handlerCtx)
  if (permissions.allowReadOne) registerReadOne(tracker, basePath, handlerCtx)
  if (permissions.allowUpdateOne) registerUpdateOne(tracker, basePath, handlerCtx)
  if (permissions.allowUpdateMany) registerUpdateMany(tracker, basePath, handlerCtx)
  if (permissions.allowUpsertOne) registerUpsertOne(tracker, basePath, handlerCtx)
  if (permissions.allowDeleteOne) registerDeleteOne(tracker, basePath, handlerCtx)
  if (permissions.allowDeleteMany) registerDeleteMany(tracker, basePath, handlerCtx)
}

/** Registers a `*` catch-all that returns 405 with an `Allow` header for the given path. */
function registerFallback(tracker: TrackingHttpServer, path: string, allow: string[]): void {
  if (!allow.length) return
  tracker.registerRoute('*', path, async (_req, res) => {
    res.setHeader?.('Allow', allow.join(', '))
    await sendError(new MethodNotAllowedError(), res)
  })
}

/**
 * Registers the 405 Method-Not-Allowed fallbacks for a prepared resource: one for the collection
 * path, one for the `:id` item path, and one for the query-builder path — each only when the
 * resource has at least one method on it.
 */
function registerMethodFallbacks(
  tracker: TrackingHttpServer,
  prepared: PreparedResource,
  queryBuilderPath: string
): void {
  const { permissions, basePath } = prepared
  registerFallback(tracker, basePath, [
    ...(permissions.allowReadMany ? ['GET'] : []),
    ...(permissions.allowCreate ? ['POST'] : []),
    ...(permissions.allowUpdateMany ? ['PATCH'] : []),
    ...(permissions.allowDeleteMany ? ['DELETE'] : [])
  ])
  registerFallback(tracker, `${basePath}/:id`, [
    ...(permissions.allowReadOne ? ['GET'] : []),
    ...(permissions.allowUpdateOne ? ['PATCH'] : []),
    ...(permissions.allowUpsertOne ? ['PUT'] : []),
    ...(permissions.allowDeleteOne ? ['DELETE'] : [])
  ])
  if (permissions.allowReadManyWithQueryBuilder)
    registerFallback(tracker, `${basePath}/${queryBuilderPath}`, ['POST'])
}

/** Registers all CRUD verb handlers and their 405 fallbacks for one prepared resource. */
export function registerResourceRoutes(
  tracker: TrackingHttpServer,
  prepared: PreparedResource,
  queryBuilderPath: string
): void {
  registerCrudHandlers(tracker, prepared, queryBuilderPath)
  registerMethodFallbacks(tracker, prepared, queryBuilderPath)
}
