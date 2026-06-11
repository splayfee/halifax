import { AllowAllAuthStrategy, type AuthStrategy } from '@/auth/AuthStrategy.js'
import { QueryBuilder } from '@/classes/QueryBuilder.js'
import { BadRequestError } from '@/errors/BadRequestError.js'
import { HttpError } from '@/errors/HttpError.js'
import { MethodNotAllowedError } from '@/errors/MethodNotAllowedError.js'
import { NotAcceptableError } from '@/errors/NotAcceptableError.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'
import { UnsupportedMediaTypeError } from '@/errors/UnsupportedMediaTypeError.js'
import type { IQueryFilter } from '@/interfaces/IQueryFilter.js'
import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'
import { defaultCrudPermissions, type CrudAction, type ResourceDefinition } from '@/core/types.js'
import type { HttpRequest, HttpResponse, HttpServer } from '@/core/types.js'
import { parseListOptions } from '@/core/queryString.js'
import { validateAdvancedQuery, validateId, isValidUuid } from '@/core/validation.js'
import { ServerError } from '@/errors/ServerError.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'

/**
 * Parses and validates a raw `:id` route parameter.
 * @param raw - The raw string value from `req.params.id`.
 * @returns A parsed integer for numeric IDs, or the original string for UUIDs.
 * @throws {@link BadRequestError} when the value is not a valid integer or UUID.
 */
function parseId(raw: string | undefined): string | number {
  validateId(raw)
  if (typeof raw === 'string' && isValidUuid(raw)) return raw
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

/** Options for {@link registerCrudApi} / {@link createExpressCrudRouter}. */
export interface CrudApiOptions {
  /** Auth strategy used for all routes. Defaults to {@link AllowAllAuthStrategy}. */
  authStrategy?: AuthStrategy
  /** Path segment for the query-builder POST route (default: `'query-builder'`). */
  queryBuilderPath?: string
  /** Path for the query-builder preview route (default: `'/query-builder/preview'`). */
  previewQueryBuilderPath?: string
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
 * Validates that all identifier-shaped values in a preview query are safe SQL identifiers.
 * Field names and the table name are interpolated directly into SQL strings (not parameterized),
 * so they must match `[a-zA-Z_][a-zA-Z0-9_.]*` to prevent unexpected SQL fragments.
 * @param query - The query AST to inspect.
 * @throws {@link BadRequestError} when any identifier contains disallowed characters.
 */
function assertSafePreviewIdentifiers(query: IQueryOptions): void {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_.]*$/
  const check = (value: string, label: string) => {
    if (!safe.test(value)) throw new BadRequestError(`Invalid ${label}: '${value}'.`)
  }
  if (query.tableName) check(query.tableName, 'table name')
  for (const f of query.fields ?? []) check(f, 'field name')
  for (const s of query.orderBy ?? []) check(s.field, 'sort field')
  const checkFilters = (filters: IQueryFilter[]) => {
    for (const f of filters) {
      if (f.field) check(f.field, 'filter field')
      if (f.children?.length) checkFilters(f.children)
    }
  }
  checkFilters(query.where ?? [])
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
 */
async function authorizeRequest(
  req: HttpRequest,
  resource: ResourceDefinition,
  action: CrudAction,
  authStrategy: AuthStrategy
): Promise<void> {
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
    return
  }

  if (requiredPermissions.length) {
    const permissions = new Set(auth.permissions ?? [])
    const roles = new Set(auth.roles ?? [])
    const allowed = requiredPermissions.every(
      (permission) => permissions.has(permission) || roles.has(permission)
    )
    if (!allowed) throw new AuthorizationError()
  }
}

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
 * A global query-builder preview endpoint is also registered at `previewQueryBuilderPath`.
 *
 * @param server - The HTTP server adapter to register routes on (e.g. {@link ExpressHttpServer}).
 * @param resources - Resource definitions to wire up as CRUD endpoints.
 * @param options - Auth strategy, query-builder path overrides, and preview path overrides.
 */
export function registerCrudApi(
  server: HttpServer,
  resources: ResourceDefinition[],
  options: CrudApiOptions = {}
): void {
  const authStrategy: AuthStrategy = options.authStrategy ?? new AllowAllAuthStrategy()
  const queryBuilderPath = options.queryBuilderPath ?? 'query-builder'
  const previewPath = options.previewQueryBuilderPath ?? '/query-builder/preview'

  resources.forEach((resource) => {
    const repository = resource.repository
    if (!repository)
      throw new ServerError(`Resource '${resource.name}' does not define a repository.`)

    const permissions = { ...defaultCrudPermissions, ...resource.permissions }
    const basePath = `/${resource.routePrefix}`

    if (permissions.allowCreate) {
      server.registerRoute(
        'POST',
        basePath,
        wrap(async (req, res) => {
          await authorizeRequest(req, resource, 'create', authStrategy)
          const idempotencyKey = getHeaderValue(req, 'idempotency-key')
          const createOptions = idempotencyKey ? { idempotencyKey } : undefined
          const items = (Array.isArray(req.body) ? req.body : [req.body]).map(
            (item: Record<string, unknown>) => filterWritableFields(resource, item)
          )
          if (items.length === 1) {
            const result = await repository.createOne(items[0] as never, createOptions)
            await res.status(201).json(result)
            return
          }
          const results = await repository.createMany(items as never[], createOptions)
          await res.status(201).json(results)
        })
      )
    }

    if (permissions.allowReadMany) {
      server.registerRoute(
        'GET',
        basePath,
        wrap(async (req, res) => {
          await authorizeRequest(req, resource, 'readMany', authStrategy)
          const listOptions = parseListOptions(req.query, resource)
          const results = await repository.getMany(listOptions)
          await res.status(200).json(results)
        })
      )
    }

    if (permissions.allowReadManyWithQueryBuilder) {
      server.registerRoute(
        'POST',
        `${basePath}/${queryBuilderPath}`,
        wrap(async (req, res) => {
          await authorizeRequest(req, resource, 'readManyWithQueryBuilder', authStrategy)
          if (!repository.executeQueryBuilder)
            throw new NotImplementedError('This resource does not support the query builder.')
          const body = (req.body ?? {}) as Record<string, unknown>
          const query = {
            ...body,
            tableName: resource.tableName
          } as IQueryOptions
          validateAdvancedQuery(resource, query)
          const results = await repository.executeQueryBuilder(query)
          await res.status(200).json(results)
        })
      )
    }

    if (permissions.allowReadOne) {
      server.registerRoute(
        'GET',
        `${basePath}/:id`,
        wrap(async (req, res) => {
          await authorizeRequest(req, resource, 'readOne', authStrategy)
          const id = parseId(req.params['id'])
          const listOptions = parseListOptions(req.query, resource)
          const result = await repository.getOne(id, {
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
          await authorizeRequest(req, resource, 'updateOne', authStrategy)
          const id = parseId(req.params['id'])
          const body = filterWritableFields(resource, req.body as Record<string, unknown>)
          const result = await repository.updateOne(id, body as never)
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
          await authorizeRequest(req, resource, 'updateMany', authStrategy)
          if (!repository.updateMany)
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
          const query = {
            ...queryBody,
            tableName: resource.tableName
          } as IQueryOptions
          validateAdvancedQuery(resource, query)
          if (!query.where?.length)
            throw new UnprocessableEntityError(
              'updateMany requires at least one WHERE filter to prevent unintended bulk updates.'
            )
          const result = await repository.updateMany(query, filteredUpdate as never)
          await res.status(200).json(result)
        })
      )
    }

    if (permissions.allowUpsertOne) {
      server.registerRoute(
        'PUT',
        `${basePath}/:id`,
        wrap(async (req, res) => {
          await authorizeRequest(req, resource, 'upsertOne', authStrategy)
          if (!repository.upsertOne)
            throw new NotImplementedError('This resource does not support upsert.')
          const id = parseId(req.params['id'])
          const body = filterWritableFields(resource, req.body as Record<string, unknown>)
          const result = await repository.upsertOne(id, body as never)
          await res.status(200).json(result)
        })
      )
    }

    if (permissions.allowDeleteOne) {
      server.registerRoute(
        'DELETE',
        `${basePath}/:id`,
        wrap(async (req, res) => {
          await authorizeRequest(req, resource, 'deleteOne', authStrategy)
          const id = parseId(req.params['id'])
          const deleted = await repository.deleteOne(id)
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
          await authorizeRequest(req, resource, 'deleteMany', authStrategy)
          if (!repository.deleteMany)
            throw new NotImplementedError('This resource does not support deleteMany.')
          const body = (req.body ?? {}) as Record<string, unknown>
          const query = {
            ...body,
            tableName: resource.tableName
          } as IQueryOptions
          validateAdvancedQuery(resource, query)
          if (!query.where?.length)
            throw new UnprocessableEntityError(
              'deleteMany requires at least one WHERE filter to prevent unintended bulk deletes.'
            )
          const result = await repository.deleteMany(query)
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

  server.registerRoute(
    'POST',
    previewPath,
    wrap(async (req, res) => {
      const auth = await authStrategy.authenticate(req)
      if (authStrategy.authorize) {
        const allowed = await authStrategy.authorize({
          auth,
          action: 'readManyWithQueryBuilder',
          resource: { name: '__preview__', routePrefix: '__preview__', fields: [], repository: null! },
          requiredPermissions: [],
          req
        })
        if (!allowed) throw new AuthorizationError()
      }
      const query = req.body as IQueryOptions
      assertSafePreviewIdentifiers(query)
      await res.status(200).json({
        count: QueryBuilder.buildCountQuery(query),
        select: QueryBuilder.buildSelectQuery(query)
      })
    })
  )
}
