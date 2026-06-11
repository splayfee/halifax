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
import type { HttpRequest, HttpResponse, HttpServer, Repository } from '@/core/types.js'
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
 * Only fields explicitly marked `writable: true` are allowed through; fields with
 * `writable: false` or `writable` unset are silently dropped.
 * @param resource - The resource definition that defines writable fields.
 * @param data - The raw request body key-value map.
 * @returns A new object containing only explicitly writable fields.
 * @throws {@link UnprocessableEntityError} when the body contains keys not defined on the resource.
 */
function filterWritableFields(
  resource: ResourceDefinition,
  data: Record<string, unknown>
): Record<string, unknown> {
  const knownFields = new Set(resource.fields.map((f) => f.name))
  const unknownFields = Object.keys(data).filter((key) => !knownFields.has(key))
  if (unknownFields.length) {
    throw new UnprocessableEntityError(`Unknown field(s): ${unknownFields.join(', ')}.`)
  }

  return Object.fromEntries(
    Object.entries(data).filter(([key]) => {
      const field = resource.fields.find((f) => f.name === key)
      return field?.writable === true
    })
  )
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
  return resource.fields.some((f) => f.name === fallback) ? fallback : null
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

  resources.forEach((resource) => {
    const repository = resource.repository
    if (!repository)
      throw new ServerError(`Resource '${resource.name}' does not define a repository.`)

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
            await res.status(201).json(result)
            return
          }
          const results = await repo.createMany(items as never[], createOptions)
          await res.status(201).json(results)
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
          await res.status(200).json(results)
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
          await res.status(200).json(results)
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
          await res.status(200).json(result)
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
          await res.status(200).json(result)
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
          await res.status(200).json(result)
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
          await res.status(200).json(result)
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
          await res.status(200).json({ deleted: true })
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
          await res.status(200).json(result)
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
