import { AllowAllAuthStrategy, type AuthContext, type AuthStrategy } from '@/auth/AuthStrategy.js'
import { createCachingRepository, InMemoryCacheStore, type CacheStore } from '@/core/cache/index.js'
import { HttpError } from '@/errors/HttpError.js'
import { MethodNotAllowedError } from '@/errors/MethodNotAllowedError.js'
import { NotAcceptableError } from '@/errors/NotAcceptableError.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'
import { UnsupportedMediaTypeError } from '@/errors/UnsupportedMediaTypeError.js'
import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'
import { defaultCrudPermissions, type CrudAction, type ResourceDefinition } from '@/core/types.js'
import type {
  FieldDefinition,
  HttpRequest,
  HttpResponse,
  HttpServer,
  RelationDefinition,
  Repository
} from '@/core/types.js'
import { parseListOptions } from '@/core/queryString.js'
import {
  validateAdvancedQuery,
  validateId,
  isValidUuid,
  isValidObjectId
} from '@/core/validation.js'
import { ServerError } from '@/errors/ServerError.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'

/**
 * Parses and validates a raw `:id` route parameter.
 * @param raw - The raw string value from `req.params.id`.
 * @returns A parsed integer for numeric IDs, or the original string for UUID / ObjectId keys.
 * @throws {@link BadRequestError} when the value is not a valid integer, UUID, or ObjectId.
 */
function parseId(raw: string | undefined): string | number {
  validateId(raw)
  // UUID and Mongo ObjectId keys are passed through as strings; only numeric ids are parsed.
  if (typeof raw === 'string' && (isValidUuid(raw) || isValidObjectId(raw))) return raw
  return typeof raw === 'string' ? parseInt(raw, 10) : raw
}

/**
 * Strips non-writable fields from a request body and rejects unknown fields with a 422.
 * Operates on a {@link normalizeResource | normalized} resource, whose fields carry explicit
 * `writable` booleans (permissive by default; the primary key protected). Fields with
 * `writable: false` are silently dropped.
 * @param resource - The normalized resource definition.
 * @param data - The raw request body key-value map.
 * @returns A new object containing only writable fields.
 * @throws {@link UnprocessableEntityError} when the body contains keys not defined on the resource.
 */
function filterWritableFields(
  resource: ResourceDefinition,
  data: Record<string, unknown>
): Record<string, unknown> {
  const fields = resource.fields ?? []
  const knownFields = new Set(fields.map((f) => f.name))
  const unknownFields = Object.keys(data).filter((key) => !knownFields.has(key))
  if (unknownFields.length) {
    throw new UnprocessableEntityError(`Unknown field(s): ${unknownFields.join(', ')}.`)
  }

  return Object.fromEntries(
    Object.entries(data).filter(([key]) => {
      const field = fields.find((f) => f.name === key)
      return field?.writable !== false
    })
  )
}

/**
 * Derives a human-readable resource name from a route prefix when none is given:
 * de-kebabs/de-snakes and title-cases each word (`'blog-posts'` → `'Blog Posts'`).
 * @param routePrefix - The resource's URL path segment.
 * @returns A title-cased display name.
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
 * Resolves the effective field list for a resource. When the repository exposes a field
 * schema it forms the base, and the resource's own `fields` are merged over it **by name**
 * as sparse overrides (entries with no matching base field are added). When the repository
 * exposes no schema, the resource's `fields` are the authoritative list.
 *
 * Every resolved field gets explicit, permissive defaults — `filterable`/`sortable`/
 * `selectable`/`writable` default to `true` — except the primary key, which is non-writable
 * unless a field entry explicitly sets `writable: true`.
 *
 * @param resource - The raw resource definition.
 * @param idField - The repository's primary-key field name (protected from writes).
 * @returns The fully-resolved field list.
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
    writable: field.name === idField ? field.writable === true : field.writable !== false
  }))
}

/**
 * Merges the repository's relation schema with the resource's own relations, by name.
 * @param resource - The raw resource definition.
 * @returns The resolved relation list (may be empty).
 */
function resolveRelations(resource: ResourceDefinition): RelationDefinition[] {
  const byName = new Map<string, RelationDefinition>()
  for (const relation of resource.repository?.relations ?? []) byName.set(relation.name, relation)
  for (const relation of resource.relations ?? []) byName.set(relation.name, relation)
  return [...byName.values()]
}

/**
 * Produces a fully-resolved resource: `name` filled in (derived from `routePrefix` when
 * omitted), and `fields`/`relations` resolved from the repository schema + the resource's
 * own (override) entries. Every downstream router stage operates on this normalized form,
 * so defaults live in exactly one place.
 * @param resource - The raw resource definition supplied by the caller.
 * @returns A normalized resource with guaranteed `name` and resolved `fields`/`relations`.
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
   * @param ctx - The auth context, request, and resource being accessed.
   * @returns The tenant key, or null/undefined when none applies.
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
   * Error responses are never enveloped. Omit (or set `null`/`''`) for bare bodies — the
   * default, and backward compatible.
   */
  envelope?: string | null
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

/** Maps HTTP status codes to machine-readable error code strings. */
const statusCodeMap: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  501: 'NOT_IMPLEMENTED'
}

/**
 * Converts any thrown value to a structured `{ status, code, message, details }` object.
 * {@link HttpError} subclasses preserve their status; all other errors become 500.
 * @param error - The caught value to normalise (may be any type).
 * @returns A plain object with `status`, `code`, `message`, and optional `details`.
 */
export function normalizeError(error: unknown): {
  status: number
  code: string
  message: string
  details?: unknown
} {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      code: statusCodeMap[error.status] ?? 'INTERNAL_ERROR',
      message: error.message,
      details: error.details
    }
  }
  if (error instanceof Error) {
    return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' }
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' }
}

/**
 * Serialises a caught error and writes it as a JSON `{ errors: [...] }` response.
 * @param error - The caught value to serialise.
 * @param res - The response object to write to.
 */
async function sendError(error: unknown, res: HttpResponse): Promise<void> {
  const { status, code, message, details } = normalizeError(error)
  const item: Record<string, unknown> = { code, message }
  if (details !== undefined) item['details'] = details
  await res.status(status).json({ errors: [item] })
}

/**
 * Resolves the effective envelope key: a non-empty string enables wrapping; `null`, `undefined`,
 * and `''` all mean "no envelope" (an empty key would produce a meaningless `{ "": body }`).
 * @param value - The per-resource or API-wide envelope setting.
 * @returns The envelope key, or `null` when responses should be sent bare.
 */
function normalizeEnvelope(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Writes a success body as JSON, wrapping it under `envelope` when one is configured.
 * The single seam through which every success response is serialised, so the envelope is
 * applied consistently and exactly once. Applied at the response boundary (after the cache),
 * so cached payloads stay envelope-agnostic.
 * @param res - The response object to write to.
 * @param status - HTTP status code to send.
 * @param body - The success payload (wrapped under `envelope` when set).
 * @param envelope - Resolved envelope key, or `null` to send the body bare.
 */
function writeSuccess(
  res: HttpResponse,
  status: number,
  body: unknown,
  envelope: string | null
): void | Promise<void> {
  return res.status(status).json(envelope ? { [envelope]: body } : body)
}

/**
 * Runs the auth strategy for `action` and throws {@link AuthorizationError} when not allowed.
 * @param req - The incoming HTTP request.
 * @param resource - The resource being accessed (used to look up required permissions).
 * @param action - The CRUD action being performed.
 * @param authStrategy - The active auth strategy.
 * @returns The resolved {@link AuthContext} (so callers can derive the tenant scope from it).
 */
async function authorizeRequest(
  req: HttpRequest,
  resource: ResourceDefinition,
  action: CrudAction,
  authStrategy: AuthStrategy
): Promise<AuthContext> {
  const auth = await authStrategy.authenticate(req)
  const requiredPermissions = resource.requiredPermissions?.[action] ?? []

  if (authStrategy.authorize) {
    const allowed = await authStrategy.authorize({
      auth,
      action,
      resource,
      requiredPermissions,
      req
    })
    if (!allowed) throw new AuthorizationError()
    return auth
  }

  if (requiredPermissions.length) {
    const permissions = new Set(auth.permissions ?? [])
    const roles = new Set(auth.roles ?? [])
    const allowed = requiredPermissions.every(
      (permission) => permissions.has(permission) || roles.has(permission)
    )
    if (!allowed) throw new AuthorizationError()
  }
  return auth
}

/**
 * Determines the column a resource is tenant-scoped on, applying this precedence:
 * explicit `resource.tenant` (or `false` to opt out) → auto-detect the API's default
 * tenant field when the resource actually has it → otherwise unscoped (global).
 * @param resource - The resource being inspected.
 * @param tenant - The API-wide tenant options, or `undefined` when tenancy is off.
 * @returns The tenant field name, or `null` when the resource is not scoped.
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

/**
 * Reads a single header value by name (case-insensitive).
 * @param req - The incoming HTTP request.
 * @param name - Header name to look up (case-insensitive).
 * @returns The header value as a string, or `undefined` when absent.
 */
function getHeaderValue(req: HttpRequest, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()] ?? req.headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : undefined
}

/**
 * Decides whether the request asks to bypass (bust) the cache. For the standard
 * `Cache-Control` header this means a `no-cache`/`no-store` directive; for any custom
 * bust header, mere presence (with a non-empty value) triggers a refresh.
 * @param req - The incoming HTTP request.
 * @param header - The configured bust header name.
 * @returns `true` when the cache should be force-refreshed for this request.
 */
function wantsCacheBust(req: HttpRequest, header: string): boolean {
  const value = getHeaderValue(req, header)
  if (!value) return false
  if (header.toLowerCase() === 'cache-control') return /no-cache|no-store/i.test(value)
  return true
}

/**
 * Throws {@link UnsupportedMediaTypeError} when a body-carrying request uses a non-JSON Content-Type.
 * @param req - The incoming HTTP request to check.
 */
function checkContentType(req: HttpRequest): void {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method.toUpperCase())) return
  const contentType = getHeaderValue(req, 'content-type') ?? ''
  if (contentType && !contentType.includes('application/json')) {
    throw new UnsupportedMediaTypeError()
  }
}

/**
 * Throws {@link NotAcceptableError} when the client's Accept header excludes `application/json`.
 * @param req - The incoming HTTP request to check.
 */
function checkAcceptHeader(req: HttpRequest): void {
  const accept = getHeaderValue(req, 'accept') ?? ''
  if (
    accept &&
    !accept.includes('*/*') &&
    !accept.includes('application/*') &&
    !accept.includes('application/json')
  ) {
    throw new NotAcceptableError()
  }
}

/**
 * Wraps a route handler with Content-Type / Accept checks, error serialisation,
 * and `X-Correlation-ID` echo-back.
 * @param handler - The inner async route handler to wrap.
 * @returns A new handler with pre/post-processing applied.
 */
function wrap(handler: (req: HttpRequest, res: HttpResponse) => Promise<void>) {
  return async (req: HttpRequest, res: HttpResponse): Promise<void> => {
    const correlationId = getHeaderValue(req, 'x-correlation-id')
    if (correlationId) res.setHeader?.('X-Correlation-ID', correlationId)
    try {
      checkContentType(req)
      checkAcceptHeader(req)
      await handler(req, res)
    } catch (error) {
      await sendError(error, res)
    }
  }
}

/**
 * Registers all CRUD routes for every resource on the given HTTP server.
 *
 * Routes are controlled by `resource.permissions` merged with {@link defaultCrudPermissions}.
 *
 * @param server - The HTTP server adapter to register routes on (e.g. {@link ExpressHttpServer}).
 * @param resources - Resource definitions to wire up as CRUD endpoints.
 * @param options - Auth strategy and query-builder path overrides.
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

    // Resolve name + field/relation schema once, here, so every downstream stage (validation,
    // write-filtering, tenant auto-detection, cache namespace) works off a single source of
    // truth with all defaults already applied.
    const resource = normalizeResource(rawResource)

    // Resolve the response envelope once: an explicit per-resource setting wins over the
    // API-wide default — including an explicit `null`/`''`, which opts this resource out.
    const envelope = normalizeEnvelope(
      resource.envelope !== undefined ? resource.envelope : options.envelope
    )

    // Resolve tenancy once at registration and fail closed on misconfiguration, so a
    // scoped resource can never be silently served unscoped at request time.
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

    // Effective cache TTL: an explicit `cache: false` disables; otherwise per-resource config
    // wins over the API-wide default. `0` means "never expire" (so `undefined` = no caching).
    const cacheTtl =
      resource.cache === false
        ? undefined
        : (resource.cache?.ttlSeconds ?? options.cache?.ttlSeconds)
    const cachingEnabled = cacheTtl !== undefined

    /**
     * Wraps a repository in the read-through cache when caching is enabled for this resource.
     * The namespace embeds the resource name and tenant key, so one tenant can never read
     * another's cached rows. `bust` (from the cache-bust header) force-refreshes this request.
     * @param repo - The (possibly tenant-scoped) repository for this request.
     * @param scopeKey - Stable key for the current tenant scope (or `'global'`).
     * @param bust - Whether the caller requested a cache-busting refresh.
     * @returns The repository, cache-wrapped when caching is enabled.
     */
    const withCache = (repo: Repository, scopeKey: string, bust: boolean): Repository =>
      cachingEnabled
        ? createCachingRepository(repo, {
            store: cacheStore,
            ttlSeconds: cacheTtl,
            namespace: `${resource.name}:${scopeKey}`,
            bust
          })
        : repo

    /**
     * Returns the repository to use for this request: the tenant-scoped clone when the
     * resource is scoped, or the bare repository otherwise — wrapped in the read-through
     * cache when enabled. Throws 403 in strict mode (the default) when a scoped resource
     * cannot resolve a tenant for the caller.
     */
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

    if (permissions.allowCreate) {
      server.registerRoute(
        'POST',
        basePath,
        wrap(async (req, res) => {
          const auth = await authorizeRequest(req, resource, 'create', authStrategy)
          const repo = await resolveRepo(req, auth)
          const idempotencyKey = getHeaderValue(req, 'idempotency-key')
          const createOptions = idempotencyKey ? { idempotencyKey } : undefined
          const items = (Array.isArray(req.body) ? req.body : [req.body]).map(
            (item: Record<string, unknown>) => filterWritableFields(resource, item)
          )
          if (items.length === 1) {
            const result = await repo.createOne(items[0] as never, createOptions)
            await writeSuccess(res, 201, result, envelope)
            return
          }
          const results = await repo.createMany(items as never[], createOptions)
          await writeSuccess(res, 201, results, envelope)
        })
      )
    }

    if (permissions.allowReadMany) {
      server.registerRoute(
        'GET',
        basePath,
        wrap(async (req, res) => {
          const auth = await authorizeRequest(req, resource, 'readMany', authStrategy)
          const repo = await resolveRepo(req, auth)
          const listOptions = parseListOptions(req.query, resource)
          const results = await repo.getMany(listOptions)
          await writeSuccess(res, 200, results, envelope)
        })
      )
    }

    if (permissions.allowReadManyWithQueryBuilder) {
      server.registerRoute(
        'POST',
        `${basePath}/${queryBuilderPath}`,
        wrap(async (req, res) => {
          const auth = await authorizeRequest(
            req,
            resource,
            'readManyWithQueryBuilder',
            authStrategy
          )
          const repo = await resolveRepo(req, auth)
          if (!repo.executeQuery)
            throw new NotImplementedError('This resource does not support the query builder.')
          const body = (req.body ?? {}) as Record<string, unknown>
          const query = { ...body } as IQueryOptions
          validateAdvancedQuery(resource, query)
          const results = await repo.executeQuery(query)
          await writeSuccess(res, 200, results, envelope)
        })
      )
    }

    if (permissions.allowReadOne) {
      server.registerRoute(
        'GET',
        `${basePath}/:id`,
        wrap(async (req, res) => {
          const auth = await authorizeRequest(req, resource, 'readOne', authStrategy)
          const repo = await resolveRepo(req, auth)
          const id = parseId(req.params['id'])
          const listOptions = parseListOptions(req.query, resource)
          const result = await repo.getOne(id, {
            fields: listOptions.fields,
            include: listOptions.include
          })
          if (!result) throw new NotFoundError()
          await writeSuccess(res, 200, result, envelope)
        })
      )
    }

    if (permissions.allowUpdateOne) {
      server.registerRoute(
        'PATCH',
        `${basePath}/:id`,
        wrap(async (req, res) => {
          const auth = await authorizeRequest(req, resource, 'updateOne', authStrategy)
          const repo = await resolveRepo(req, auth)
          const id = parseId(req.params['id'])
          const body = filterWritableFields(resource, req.body as Record<string, unknown>)
          const result = await repo.updateOne(id, body as never)
          if (!result) throw new NotFoundError()
          await writeSuccess(res, 200, result, envelope)
        })
      )
    }

    if (permissions.allowUpdateMany) {
      server.registerRoute(
        'PATCH',
        basePath,
        wrap(async (req, res) => {
          const auth = await authorizeRequest(req, resource, 'updateMany', authStrategy)
          const repo = await resolveRepo(req, auth)
          if (!repo.updateMany)
            throw new NotImplementedError('This resource does not support updateMany.')
          const { update, ...queryBody } = (req.body ?? {}) as Record<string, unknown>
          const filteredUpdate = filterWritableFields(
            resource,
            (update ?? {}) as Record<string, unknown>
          )
          if (!Object.keys(filteredUpdate).length)
            throw new UnprocessableEntityError(
              'updateMany requires at least one writable field in the update payload.'
            )
          const query = { ...queryBody } as IQueryOptions
          validateAdvancedQuery(resource, query)
          if (!query.where?.length)
            throw new UnprocessableEntityError(
              'updateMany requires at least one WHERE filter to prevent unintended bulk updates.'
            )
          const result = await repo.updateMany(query, filteredUpdate as never)
          await writeSuccess(res, 200, result, envelope)
        })
      )
    }

    if (permissions.allowUpsertOne) {
      server.registerRoute(
        'PUT',
        `${basePath}/:id`,
        wrap(async (req, res) => {
          const auth = await authorizeRequest(req, resource, 'upsertOne', authStrategy)
          const repo = await resolveRepo(req, auth)
          if (!repo.upsertOne)
            throw new NotImplementedError('This resource does not support upsert.')
          const id = parseId(req.params['id'])
          const body = filterWritableFields(resource, req.body as Record<string, unknown>)
          const result = await repo.upsertOne(id, body as never)
          await writeSuccess(res, 200, result, envelope)
        })
      )
    }

    if (permissions.allowDeleteOne) {
      server.registerRoute(
        'DELETE',
        `${basePath}/:id`,
        wrap(async (req, res) => {
          const auth = await authorizeRequest(req, resource, 'deleteOne', authStrategy)
          const repo = await resolveRepo(req, auth)
          const id = parseId(req.params['id'])
          const deleted = await repo.deleteOne(id)
          if (!deleted) throw new NotFoundError()
          await writeSuccess(res, 200, { deleted: true }, envelope)
        })
      )
    }

    if (permissions.allowDeleteMany) {
      server.registerRoute(
        'DELETE',
        basePath,
        wrap(async (req, res) => {
          const auth = await authorizeRequest(req, resource, 'deleteMany', authStrategy)
          const repo = await resolveRepo(req, auth)
          if (!repo.deleteMany)
            throw new NotImplementedError('This resource does not support deleteMany.')
          const body = (req.body ?? {}) as Record<string, unknown>
          const query = { ...body } as IQueryOptions
          validateAdvancedQuery(resource, query)
          if (!query.where?.length)
            throw new UnprocessableEntityError(
              'deleteMany requires at least one WHERE filter to prevent unintended bulk deletes.'
            )
          const result = await repo.deleteMany(query)
          await writeSuccess(res, 200, result, envelope)
        })
      )
    }

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
}
