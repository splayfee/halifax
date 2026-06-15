import { AllowAllAuthStrategy, type AuthContext, type AuthStrategy } from '@/auth/AuthStrategy.js'
import type { CrudHooks } from '@/core/hooks.js'
import { createCachingRepository, InMemoryCacheStore, type CacheStore } from '@/core/cache/index.js'
import { generateOpenApiSpec, generateDocsHtml, type OpenApiOptions } from '@/openapi/index.js'
import { defaultCrudPermissions, type ResourceDefinition } from '@/core/types.js'
import type {
  FieldDefinition,
  HttpRequest,
  HttpServer,
  RelationDefinition,
  Repository
} from '@/core/types.js'
import { ServerError } from '@/errors/ServerError.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'
import { MethodNotAllowedError } from '@/errors/MethodNotAllowedError.js'
import {
  normalizeError,
  sendError,
  wantsCacheBust,
  type RouteHandlerContext
} from '@/core/handlerUtils.js'
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

/**
 * Derives a human-readable resource name from a route prefix when none is given:
 * de-kebabs/de-snakes and title-cases each word (`'blog-posts'` → `'Blog Posts'`).
 */
function deriveResourceName(routePrefix: string): string {
  return (
    routePrefix
      .split(/[-_/\s]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ') || routePrefix
  )
}

/**
 * Resolves the effective field list for a resource. Merges the repository's field schema
 * with the resource's own `fields` as sparse overrides. Applies permissive defaults for all
 * flags except the primary key, which is non-writable unless explicitly opted in.
 * @throws {@link ServerError} when neither the repository nor the resource provides any fields.
 */
function resolveFields(resource: ResourceDefinition, idField: string): FieldDefinition[] {
  const byName = new Map<string, FieldDefinition>()
  for (const field of resource.repository?.fields ?? []) byName.set(field.name, { ...field })
  for (const override of resource.fields ?? [])
    byName.set(override.name, { ...byName.get(override.name), ...override })

  const merged = [...byName.values()]
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
 * Merges the repository's relation schema with the resource's own relations, by name.
 */
function resolveRelations(resource: ResourceDefinition): RelationDefinition[] {
  const byName = new Map<string, RelationDefinition>()
  for (const relation of resource.repository?.relations ?? []) byName.set(relation.name, relation)
  for (const relation of resource.relations ?? []) byName.set(relation.name, relation)
  return [...byName.values()]
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
    name: resource.name ?? deriveResourceName(resource.routePrefix),
    fields: resolveFields(resource, idField),
    relations: resolveRelations(resource)
  }
}

/**
 * Resolves the effective envelope key. A non-empty string enables wrapping; `null`, `undefined`,
 * and `''` all mean "no envelope".
 */
function normalizeEnvelope(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
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

/**
 * Registers all CRUD routes for every resource on the given HTTP server.
 *
 * Routes are controlled by `resource.permissions` merged with {@link defaultCrudPermissions}.
 *
 * @param server - The HTTP server adapter to register routes on.
 * @param resources - Resource definitions to wire up as CRUD endpoints.
 * @param options - Auth strategy, tenant config, envelope, caching, and OpenAPI overrides.
 */
export function registerCrudApi(
  server: HttpServer,
  resources: ResourceDefinition[],
  options: CrudApiOptions = {}
): void {
  const authStrategy: AuthStrategy = options.authStrategy ?? new AllowAllAuthStrategy()
  const queryBuilderPath = options.queryBuilderPath ?? 'query'
  // One shared cache store for the whole API (created lazily only if any resource caches),
  // so version-based invalidation is consistent across requests and resources.
  const cacheStore: CacheStore = options.cache?.store ?? new InMemoryCacheStore()
  const bustHeader = options.cache?.bustHeader ?? 'cache-control'

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

    // Effective cache TTL: explicit `cache: false` disables; per-resource config wins over
    // API-wide default. `0` means "never expire" (so `undefined` = no caching).
    const cacheTtl =
      resource.cache === false
        ? undefined
        : (resource.cache?.ttlSeconds ?? options.cache?.ttlSeconds)
    const cachingEnabled = cacheTtl !== undefined

    const withCache = (repo: Repository, scopeKey: string, bust: boolean): Repository =>
      cachingEnabled
        ? createCachingRepository(repo, {
            store: cacheStore,
            ttlSeconds: cacheTtl,
            namespace: `${resource.name}:${scopeKey}`,
            bust
          })
        : repo

    const resolveRepo = async (req: HttpRequest, auth: AuthContext): Promise<Repository> => {
      const bust = cachingEnabled && wantsCacheBust(req, bustHeader)
      if (!tenantField || !options.tenant) return withCache(repository, 'global', bust)
      const value = await options.tenant.resolveId({ auth, req, resource })
      if (value === undefined || value === null || value === '') {
        if (options.tenant.strict !== false)
          throw new AuthorizationError('No tenant is associated with this request.')
        return withCache(repository, 'global', bust)
      }
      return withCache(repository.withScope!({ field: tenantField, value }), String(value), bust)
    }

    const permissions = { ...defaultCrudPermissions, ...resource.permissions }
    const basePath = `/${resource.routePrefix}`
    // Cast to the widest usable type once so every handler can call hooks without generics.
    const hooks = resource.hooks as
      | CrudHooks<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>
      | undefined

    const handlerCtx: RouteHandlerContext = { resource, authStrategy, envelope, hooks, resolveRepo }

    if (permissions.allowCreate) registerCreate(server, basePath, handlerCtx)
    if (permissions.allowReadMany) registerReadMany(server, basePath, handlerCtx)
    if (permissions.allowReadManyWithQueryBuilder)
      registerQuery(server, basePath, queryBuilderPath, handlerCtx)
    if (permissions.allowReadOne) registerReadOne(server, basePath, handlerCtx)
    if (permissions.allowUpdateOne) registerUpdateOne(server, basePath, handlerCtx)
    if (permissions.allowUpdateMany) registerUpdateMany(server, basePath, handlerCtx)
    if (permissions.allowUpsertOne) registerUpsertOne(server, basePath, handlerCtx)
    if (permissions.allowDeleteOne) registerDeleteOne(server, basePath, handlerCtx)
    if (permissions.allowDeleteMany) registerDeleteMany(server, basePath, handlerCtx)

    // 405 fallbacks — only registered when at least one method exists for the path
    const baseMethods: string[] = [
      ...(permissions.allowReadMany ? ['GET'] : []),
      ...(permissions.allowCreate ? ['POST'] : []),
      ...(permissions.allowUpdateMany ? ['PATCH'] : []),
      ...(permissions.allowDeleteMany ? ['DELETE'] : [])
    ]
    if (baseMethods.length) {
      server.registerRoute('*', basePath, async (req, res) => {
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
      server.registerRoute('*', `${basePath}/:id`, async (req, res) => {
        res.setHeader?.('Allow', idMethods.join(', '))
        await sendError(new MethodNotAllowedError(), res)
      })
    }

    if (permissions.allowReadManyWithQueryBuilder) {
      server.registerRoute('*', `${basePath}/${queryBuilderPath}`, async (req, res) => {
        res.setHeader?.('Allow', 'POST')
        await sendError(new MethodNotAllowedError(), res)
      })
    }
  })

  if (options.openapi && options.openapi.enabled !== false) {
    const specPath = options.openapi.specPath ?? '/openapi.json'
    const docsPath = options.openapi.docsPath ?? '/docs'
    const resolvedEnvelope = options.openapi.envelope ?? options.envelope ?? null
    const resolvedScheme = options.openapi.securityScheme ?? authStrategy.openApiScheme?.()
    const openApiOpts = {
      ...options.openapi,
      envelope: resolvedEnvelope,
      ...(resolvedScheme ? { securityScheme: resolvedScheme } : {})
    }
    const spec = generateOpenApiSpec(resources, openApiOpts)
    const specJson = JSON.stringify(spec, null, 2)
    const docsHtml = generateDocsHtml(specPath, docsPath)

    const requireAuth = options.openapi.requireAuth === true

    server.registerRoute('GET', specPath, async (req, res) => {
      try {
        if (requireAuth) await authStrategy.authenticate(req)
        res.setHeader?.('Content-Type', 'application/json')
        res.send?.(specJson)
      } catch (error) {
        await sendError(error, res)
      }
    })

    server.registerRoute('GET', docsPath, async (req, res) => {
      try {
        if (requireAuth) await authStrategy.authenticate(req)
        res.setHeader?.('Content-Type', 'text/html; charset=utf-8')
        res.send?.(docsHtml)
      } catch (error) {
        await sendError(error, res)
      }
    })
  }
}
