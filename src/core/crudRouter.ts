import { AllowAllAuthStrategy, type AuthContext, type AuthStrategy } from '@/auth/AuthStrategy.js'
import { checkRequiredPermissions } from '@/auth/strategies/types.js'
import type { CrudHooks } from '@/core/hooks.js'
import { createCachingRepository, InMemoryCacheStore, type CacheStore } from '@/core/cache/index.js'
import { generateOpenApiSpec, generateDocsHtml, type OpenApiOptions } from '@/openapi/index.js'
import type { OpenApiSpec, OpenApiOperation } from '@/openapi/types.js'
import { registerGraphqlRoute, type GraphQLOptions } from '@/graphql/index.js'
import { defaultCrudPermissions, type CrudAction, type ResourceDefinition } from '@/core/types.js'
import type {
  FieldDefinition,
  HttpMethod,
  HttpRequest,
  HttpResponse,
  HttpRouteHandler,
  HttpServer,
  Repository
} from '@/core/types.js'
import { toTitleCase } from '@/core/stringUtils.js'
import { ServerError } from '@/errors/ServerError.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'
import { MethodNotAllowedError } from '@/errors/MethodNotAllowedError.js'
import { normalizeError, sendError } from '@/core/errorUtils.js'
import { wantsCacheBust, wrap, type RouteHandlerContext } from '@/core/handlerUtils.js'
import { mergeFieldDefinitions, mergeRelationDefinitions, normalizeEnvelope } from '@/core/fields.js'
import { registerCreate } from '@/core/handlers/create.js'
import { registerReadMany } from '@/core/handlers/readMany.js'
import { registerReadOne } from '@/core/handlers/readOne.js'
import { registerQuery } from '@/core/handlers/query.js'
import { registerUpdateOne } from '@/core/handlers/updateOne.js'
import { registerUpdateMany } from '@/core/handlers/updateMany.js'
import { registerUpsertOne } from '@/core/handlers/upsertOne.js'
import { registerDeleteOne } from '@/core/handlers/deleteOne.js'
import { registerDeleteMany } from '@/core/handlers/deleteMany.js'

export { normalizeError }

// ─── Custom endpoint types ────────────────────────────────────────────────────

/** Resolved context passed as the third argument to every custom endpoint handler. */
export interface CustomEndpointContext {
  /** The authenticated caller's identity, resolved by the configured auth strategy. */
  auth: AuthContext
}

/**
 * Handler function for a custom endpoint registered via {@link HalifaxApi.addCustomEndpoint}.
 * Receives the raw request, response, and a pre-resolved auth context.
 * Throw any {@link HttpError} subclass to get a structured JSON error response automatically.
 */
export type CustomEndpointHandler = (
  req: HttpRequest,
  res: HttpResponse,
  ctx: CustomEndpointContext
) => Promise<void> | void

/**
 * Optional OpenAPI 3.1 metadata for a custom endpoint. When provided and the API was
 * configured with `openapi: { enabled: true }`, the operation is merged into the live spec
 * so it appears in `/openapi.json` and the Swagger UI immediately after registration.
 */
export interface CustomEndpointOpenApi extends Omit<OpenApiOperation, 'responses'> {
  /** HTTP response descriptions. Defaults to `{ '200': { description: 'OK' } }` when omitted. */
  responses?: OpenApiOperation['responses']
}

// ─── Internal tracking wrapper ────────────────────────────────────────────────

/** Wraps an {@link HttpServer} to record every registered route in a shared Set. */
class TrackingHttpServer implements HttpServer {
  constructor(
    private readonly inner: HttpServer,
    private readonly routes: Set<string>
  ) {}

  registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void {
    // Wildcard catch-all fallbacks (405 handlers) are not real endpoints — skip them.
    if (method !== '*') this.routes.add(`${method}:${path}`)
    this.inner.registerRoute(method, path, handler)
  }

  start(port: number, host?: string): Promise<void> | void {
    return this.inner.start(port, host)
  }
}

// ─── HalifaxApi ───────────────────────────────────────────────────────────────

/**
 * The object returned by {@link registerCrudApi}. Holds a reference to the live server
 * and spec so custom endpoints can be added after initial registration.
 *
 * @example
 * ```ts
 * const api = registerCrudApi(server, resources, options)
 *
 * api.addCustomEndpoint(
 *   'GET',
 *   '/reports/sales-summary',
 *   ['analyst'],
 *   async (req, res, ctx) => {
 *     const data = await buildReport(ctx.auth)
 *     await res.status(200).json(data)
 *   },
 *   { summary: 'Sales summary report', tags: ['Reports'] }
 * )
 * ```
 */
export class HalifaxApi {
  private readonly registeredRoutes: Set<string>
  private readonly liveSpec: OpenApiSpec | null

  /**
   * @internal — constructed exclusively by {@link registerCrudApi}.
   */
  constructor(
    private readonly server: HttpServer,
    private readonly authStrategy: AuthStrategy,
    registeredRoutes: Set<string>,
    liveSpec: OpenApiSpec | null
  ) {
    this.registeredRoutes = registeredRoutes
    this.liveSpec = liveSpec
  }

  /**
   * Registers a custom route that participates in Halifax's auth, error handling,
   * and (optionally) OpenAPI documentation.
   *
   * @param method - HTTP verb (`'GET'`, `'POST'`, `'PUT'`, `'PATCH'`, `'DELETE'`).
   * @param path - Route path, e.g. `'/reports/sales-summary'` or `'/orders/:id/invoice'`.
   * @param roles - Required roles/permissions (OR logic — any single match grants access).
   *   Pass an empty array `[]` to allow any authenticated caller.
   * @param handler - Your business logic. Receives the request, response, and `ctx.auth`.
   *   Throw any {@link HttpError} subclass for structured error responses.
   * @param openapi - Optional OpenAPI metadata merged into the live spec immediately.
   * @returns `this` for chaining.
   * @throws {@link ServerError} when `method + path` is already registered.
   */
  addCustomEndpoint(
    method: Exclude<HttpMethod, '*'>,
    path: string,
    roles: string[],
    handler: CustomEndpointHandler,
    openapi?: CustomEndpointOpenApi
  ): this {
    const key = `${method}:${path}`
    if (this.registeredRoutes.has(key)) {
      throw new ServerError(
        `Cannot register custom endpoint — ${method} ${path} is already registered.`
      )
    }
    this.registeredRoutes.add(key)

    const { authStrategy } = this
    this.server.registerRoute(
      method,
      path,
      wrap(async (req, res) => {
        const auth = await authStrategy.authenticate(req)
        if (roles.length > 0 && !checkRequiredPermissions(auth, roles)) {
          throw new AuthorizationError()
        }
        await handler(req, res, { auth })
      })
    )

    if (this.liveSpec && openapi) {
      const httpMethod = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
      this.liveSpec.paths[path] ??= {}
      this.liveSpec.paths[path]![httpMethod] = {
        ...(openapi.operationId !== undefined ? { operationId: openapi.operationId } : {}),
        ...(openapi.summary !== undefined ? { summary: openapi.summary } : {}),
        ...(openapi.description !== undefined ? { description: openapi.description } : {}),
        ...(openapi.tags !== undefined ? { tags: openapi.tags } : {}),
        ...(openapi.parameters !== undefined ? { parameters: openapi.parameters } : {}),
        ...(openapi.requestBody !== undefined ? { requestBody: openapi.requestBody } : {}),
        responses: openapi.responses ?? { '200': { description: 'OK' } }
      }
    }

    return this
  }
}

// ─── Internal resource helpers ────────────────────────────────────────────────

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
function normalizeResource(resource: ResourceDefinition): ResourceDefinition {
  const idField = resource.repository?.idField ?? 'id'
  return {
    ...resource,
    name: resource.name ?? toTitleCase(resource.routePrefix),
    fields: resolveFields(resource, idField),
    relations: mergeRelationDefinitions(resource)
  }
}

/**
 * Determines the column a resource is tenant-scoped on, with this precedence:
 * explicit `resource.tenant` (or `false` to opt out) → auto-detect the API's default
 * tenant field when the resource actually has it → otherwise unscoped (global).
 */
function effectiveTenantField(
  resource: ResourceDefinition,
  tenant: TenantOptions | undefined
): string | null {
  if (!tenant) return null
  if (resource.tenant === false) return null
  if (resource.tenant && resource.tenant.field) return resource.tenant.field
  const fallback = tenant.field ?? 'tenantId'
  return (resource.fields ?? []).some((f) => f.name === fallback) ? fallback : null
}

/** Matches a safe SQL identifier — tenant fields are interpolated into SQL on bulk paths. */
const safeIdentifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** Read-only actions that admin bypass applies to. Writes always enforce tenant scoping. */
const READ_ACTIONS = new Set<CrudAction>(['readOne', 'readMany', 'readManyWithQueryBuilder'])

/**
 * Builds the `resolveRepo` closure for a resource — shared by REST and GraphQL route registration
 * so the tenant-scoping and caching logic is defined exactly once.
 */
function buildResolveRepo(
  resource: ResourceDefinition,
  repository: Repository,
  tenantField: string | null,
  options: Pick<CrudApiOptions, 'tenant' | 'cache'>,
  cacheStore: CacheStore,
  bustHeader: string
): (req: HttpRequest, auth: AuthContext, action: CrudAction) => Promise<Repository> {
  const cacheTtl =
    resource.cache === false
      ? undefined
      : (resource.cache?.ttlSeconds ?? options.cache?.ttlSeconds)
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
    if (READ_ACTIONS.has(action) && bypassRoles.length > 0 && checkRequiredPermissions(auth, bypassRoles)) {
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

/** Context handed to {@link TenantOptions.resolveId} for the current request. */
export interface TenantResolveContext {
  /** The resolved authentication context for the request. */
  auth: AuthContext
  /** The incoming HTTP request. */
  req: HttpRequest
  /** The resource being accessed. */
  resource: ResourceDefinition
}

/**
 * Configures multi-tenant isolation for the whole API. When set, every resource that
 * is tenant-scoped (see {@link ResourceDefinition.tenant}) has all of its reads, writes,
 * and bulk operations confined to the tenant value returned by {@link TenantOptions.resolveId}.
 */
export interface TenantOptions {
  /**
   * Resolve the tenant key the current caller is bound to (e.g. their company id),
   * derived from the authenticated session/token — never from client-supplied input.
   * Return `null`/`undefined` to signal "no tenant"; combined with {@link TenantOptions.strict}
   * this either denies the request (default) or serves it unscoped.
   */
  resolveId: (ctx: TenantResolveContext) => unknown | Promise<unknown>
  /**
   * Default tenant column name used to auto-detect scoping: any resource that has a
   * field with this name (and no explicit {@link ResourceDefinition.tenant}) is scoped
   * on it. Defaults to `'tenantId'`.
   */
  field?: string
  /**
   * Fail-closed switch. When `true` (the default), a tenant-scoped resource whose
   * {@link TenantOptions.resolveId} returns no value rejects the request with 403 rather
   * than serving unscoped data. Only set to `false` if you deliberately allow
   * cross-tenant ("god mode") access for callers with no tenant.
   */
  strict?: boolean
  /**
   * Roles or permission slugs whose holders may bypass tenant scoping for **read** operations
   * (`getOne`, `getMany`, and the query builder), allowing them to see records across all tenants.
   * Any single match in `auth.roles` or `auth.permissions` grants the bypass.
   *
   * When a bypass caller wants to see only one tenant's data they use the normal filter
   * mechanism — `?companyId=42` on REST or `filter: { companyId: 42 }` in GraphQL.
   * No special header or query parameter is needed; the tenant field is just another filterable
   * column from the admin's perspective.
   *
   * Write operations (create / update / delete) are **never** bypassed: the tenant value
   * continues to come from `resolveId`, keeping write provenance tied to auth — never to
   * client-supplied input. An admin whose token carries no tenant will receive 403 on writes
   * unless `strict` is `false`.
   *
   * Per-resource {@link ResourceDefinition.bypassTenantRoles} takes precedence over this list.
   *
   * @example
   * ```ts
   * bypassRoles: ['super_admin', 'support:read-all']
   * ```
   */
  bypassRoles?: string[]
}

/** Options for {@link registerCrudApi} / {@link createExpressCrudRouter}. */
export interface CrudApiOptions {
  /** Auth strategy used for all routes. Defaults to {@link AllowAllAuthStrategy}. */
  authStrategy?: AuthStrategy
  /** Multi-tenant isolation config. When omitted, no tenant scoping is applied. */
  tenant?: TenantOptions
  /** Path segment for the query-builder POST route (default: `'query'`). */
  queryBuilderPath?: string
  /**
   * Wrap every success response body under a single key (e.g. `'data'` → `{ "data": <body> }`)
   * for all resources. Per-resource {@link ResourceDefinition.envelope} takes precedence.
   * Error responses are never enveloped.
   */
  envelope?: string | null
  /**
   * Enable OpenAPI 3.1 spec generation and interactive docs. When set, Halifax registers two
   * additional routes: `GET /openapi.json` (raw spec) and `GET /docs` (Swagger UI).
   */
  openapi?: OpenApiOptions
  /**
   * Enable a GraphQL endpoint. GraphQL is **disabled by default** — you must set
   * `enabled: true` to activate it. When enabled, Halifax registers `POST <path>` (execution)
   * and optionally `GET <path>` (GraphiQL IDE). The schema is auto-generated from all
   * resources that have `graphql !== false`. Requires the `graphql` peer dependency.
   *
   * See [README_GRAPHQL.md](./README_GRAPHQL.md) for full docs and examples.
   *
   * @example
   * ```ts
   * graphql: { enabled: true, path: '/graphql', graphiql: true }
   * ```
   */
  graphql?: GraphQLOptions
  /**
   * API-wide read-through caching. Provide a `store` (defaults to an in-process
   * {@link InMemoryCacheStore}) and/or a default `ttlSeconds` applied to every resource that
   * doesn't set its own {@link ResourceDefinition.cache}. Per-resource config takes precedence.
   */
  cache?: {
    /** Backing cache store shared by all resources. Defaults to an in-process store. */
    store?: CacheStore
    /**
     * Default TTL (seconds) applied to all resources lacking their own cache config.
     * `0` means never expire; omit to leave caching off by default.
     */
    ttlSeconds?: number
    /**
     * Request header that force-refreshes the cache for that request. Defaults to
     * `'Cache-Control'` (busts when the value contains `no-cache`/`no-store`). Set a custom
     * header name to bust whenever that header is present with any value.
     */
    bustHeader?: string
  }
}

// ─── Shared type for per-resource GraphQL context ─────────────────────────────

type GqlCtx = {
  resource: ResourceDefinition
  hooks: CrudHooks<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> | undefined
  resolveRepo: (req: HttpRequest, auth: AuthContext, action: CrudAction) => Promise<Repository>
}

// ─── OpenAPI wiring ────────────────────────────────────────────────────────────

function setupOpenApi(
  tracker: TrackingHttpServer,
  resources: ResourceDefinition[],
  options: CrudApiOptions,
  authStrategy: AuthStrategy
): OpenApiSpec | null {
  if (!options.openapi || options.openapi.enabled === false) return null

  const specPath = options.openapi.specPath ?? '/openapi.json'
  const docsPath = options.openapi.docsPath ?? '/docs'
  const resolvedEnvelope = options.openapi.envelope ?? options.envelope ?? null
  const resolvedScheme = options.openapi.securityScheme ?? authStrategy.openApiScheme?.()
  const openApiOpts = {
    ...options.openapi,
    envelope: resolvedEnvelope,
    ...(resolvedScheme ? { securityScheme: resolvedScheme } : {})
  }
  // Keep spec as a live object so addCustomEndpoint can mutate it; serialize on each request
  // rather than once at startup so custom endpoints registered after this point appear in docs.
  const spec = generateOpenApiSpec(resources, openApiOpts)
  const docsHtml = generateDocsHtml(specPath, docsPath)
  const requireAuth = options.openapi.requireAuth === true

  tracker.registerRoute('GET', specPath, async (req, res) => {
    try {
      if (requireAuth) await authStrategy.authenticate(req)
      res.setHeader?.('Content-Type', 'application/json')
      res.send?.(JSON.stringify(spec, null, 2))
    } catch (error) {
      await sendError(error, res)
    }
  })

  tracker.registerRoute('GET', docsPath, async (req, res) => {
    try {
      if (requireAuth) await authStrategy.authenticate(req)
      res.setHeader?.('Content-Type', 'text/html; charset=utf-8')
      res.send?.(docsHtml)
    } catch (error) {
      await sendError(error, res)
    }
  })

  return spec
}

// ─── GraphQL wiring ────────────────────────────────────────────────────────────

function setupGraphql(
  tracker: TrackingHttpServer,
  gqlContexts: GqlCtx[],
  options: CrudApiOptions,
  authStrategy: AuthStrategy
): void {
  if (options.graphql?.enabled !== true) return
  registerGraphqlRoute(
    tracker,
    gqlContexts.map(({ resource, hooks, resolveRepo }) => ({
      resource,
      authStrategy,
      hooks,
      resolveRepo
    })),
    options.graphql,
    authStrategy
  )
}

/**
 * Registers all CRUD routes for every resource on the given HTTP server and returns a
 * {@link HalifaxApi} instance. Use the returned instance to add custom endpoints that
 * participate in Halifax's auth, error handling, and OpenAPI documentation.
 *
 * Routes are controlled by `resource.permissions` merged with {@link defaultCrudPermissions}.
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

  resources.forEach((rawResource) => {
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

    const resolveRepo = buildResolveRepo(resource, repository, tenantField, options, cacheStore, bustHeader)

    const permissions = { ...defaultCrudPermissions, ...resource.permissions }
    const basePath = `/${resource.routePrefix}`
    // Cast to the widest usable type once so every handler can call hooks without generics.
    const hooks = resource.hooks as
      | CrudHooks<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>
      | undefined

    gqlContexts.push({ resource, hooks, resolveRepo })
    const handlerCtx: RouteHandlerContext = { resource, authStrategy, envelope, hooks, resolveRepo }

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

    // 405 fallbacks — only registered when at least one method exists for the path
    const baseMethods: string[] = [
      ...(permissions.allowReadMany ? ['GET'] : []),
      ...(permissions.allowCreate ? ['POST'] : []),
      ...(permissions.allowUpdateMany ? ['PATCH'] : []),
      ...(permissions.allowDeleteMany ? ['DELETE'] : [])
    ]
    if (baseMethods.length) {
      tracker.registerRoute('*', basePath, async (req, res) => {
        res.setHeader?.('Allow', baseMethods.join(', '))
        await sendError(new MethodNotAllowedError(), res)
      })
    }

    const idMethods: string[] = [
      ...(permissions.allowReadOne ? ['GET'] : []),
      ...(permissions.allowUpdateOne ? ['PATCH'] : []),
      ...(permissions.allowUpsertOne ? ['PUT'] : []),
      ...(permissions.allowDeleteOne ? ['DELETE'] : [])
    ]
    if (idMethods.length) {
      tracker.registerRoute('*', `${basePath}/:id`, async (req, res) => {
        res.setHeader?.('Allow', idMethods.join(', '))
        await sendError(new MethodNotAllowedError(), res)
      })
    }

    if (permissions.allowReadManyWithQueryBuilder) {
      tracker.registerRoute('*', `${basePath}/${queryBuilderPath}`, async (req, res) => {
        res.setHeader?.('Allow', 'POST')
        await sendError(new MethodNotAllowedError(), res)
      })
    }
  })

  setupGraphql(tracker, gqlContexts, options, authStrategy)
  const liveSpec = setupOpenApi(tracker, resources, options, authStrategy)

  return new HalifaxApi(server, authStrategy, registeredRoutes, liveSpec)
}
