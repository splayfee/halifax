import { AllowAllAuthStrategy, type AuthStrategy } from '@/auth/AuthStrategy.js'
import { InMemoryCacheStore, type CacheStore } from '@/core/cache/index.js'
import type { HttpServer, ResourceDefinition } from '@/core/types.js'
import { normalizeError } from '@/core/errorUtils.js'
import { TrackingHttpServer } from '@/core/router/trackingHttpServer.js'
import { HalifaxApi } from '@/core/router/halifaxApi.js'
import { prepareResource, registerResourceRoutes } from '@/core/router/resourceRoutes.js'
import { setupGraphql, type GqlCtx } from '@/core/router/graphqlRoutes.js'
import { setupOpenApi } from '@/core/router/openApiRoutes.js'
import { registerExecuteEndpoint } from '@/core/execute.js'
import type { CrudApiOptions } from '@/core/router/options.js'

// `normalizeError` is re-exported for consumers that serialize Halifax errors outside a router.
export { normalizeError }

// The public router surface is composed from focused modules under `@/core/router/` and
// re-exported here so the long-standing `@/core/crudRouter.js` import path is unchanged.
export { HalifaxApi } from '@/core/router/halifaxApi.js'
export type { CrudApiOptions, TenantOptions, TenantResolveContext } from '@/core/router/options.js'
export type {
  CustomEndpointContext,
  CustomEndpointHandler,
  CustomEndpointAuthorizer,
  CustomEndpointOpenApi,
  CustomEndpointOptions,
  CustomEndpointSchemas,
  CustomEndpointMethod
} from '@/core/customEndpoint.js'
export { registerExecuteEndpoint } from '@/core/execute.js'
export type { SqlExecutor, ExecuteOptions, ExecuteProcedure } from '@/core/execute.js'

/**
 * Registers all CRUD routes for every resource on the given HTTP server and returns a
 * {@link HalifaxApi} instance. Use the returned instance to add custom endpoints that
 * participate in Halifax's auth, error handling, and OpenAPI documentation.
 *
 * Routes are controlled by `resource.permissions` merged with `defaultCrudPermissions`.
 * The per-resource work is delegated to {@link prepareResource} (normalization, tenancy, context
 * building) and {@link registerResourceRoutes} (CRUD verbs + 405 fallbacks); GraphQL and OpenAPI
 * are wired once at the end from the same resolved contexts.
 *
 * @param server - The HTTP server adapter to register routes on.
 * @param resources - Resource definitions to wire up as CRUD endpoints.
 * @param options - Auth strategy, tenant config, envelope, caching, and OpenAPI overrides.
 * @returns A {@link HalifaxApi} singleton for the registered API.
 */
export function registerCrudApi(
  server: HttpServer,
  resources: ResourceDefinition[],
  options: CrudApiOptions = {}
): HalifaxApi {
  const authStrategy: AuthStrategy = options.authStrategy ?? new AllowAllAuthStrategy()
  const registeredRoutes = new Set<string>()
  const tracker = new TrackingHttpServer(server, registeredRoutes)
  const queryBuilderPath = options.queryBuilderPath ?? 'query'
  // One shared cache store for the whole API (created lazily only if any resource caches),
  // so version-based invalidation is consistent across requests and resources.
  const cacheStore: CacheStore = options.cache?.store ?? new InMemoryCacheStore()
  const bustHeader = options.cache?.bustHeader ?? 'cache-control'

  const gqlContexts: GqlCtx[] = []
  for (const rawResource of resources) {
    const prepared = prepareResource(rawResource, options, authStrategy, cacheStore, bustHeader)
    gqlContexts.push(prepared.gqlCtx)
    registerResourceRoutes(tracker, prepared, queryBuilderPath)
  }

  setupGraphql(tracker, gqlContexts, options, authStrategy)
  const liveSpec = setupOpenApi(tracker, resources, options, authStrategy)

  const api = new HalifaxApi(server, authStrategy, registeredRoutes, liveSpec)

  // Off by default (like GraphQL): the execute route is registered only when configured.
  if (options.execute) registerExecuteEndpoint(api, options.execute)

  return api
}
