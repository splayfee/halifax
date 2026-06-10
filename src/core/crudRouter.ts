import { AllowAllAuthStrategy, type AuthStrategy } from '@/auth/AuthStrategy.js'
import { QueryBuilder } from '@/classes/QueryBuilder.js'
import { HttpError } from '@/errors/HttpError.js'
import { MethodNotAllowedError } from '@/errors/MethodNotAllowedError.js'
import { NotAcceptableError } from '@/errors/NotAcceptableError.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { UnsupportedMediaTypeError } from '@/errors/UnsupportedMediaTypeError.js'
import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'
import { defaultCrudPermissions, type CrudAction, type ResourceDefinition } from '@/core/types.js'
import type { HttpRequest, HttpResponse, HttpServer } from '@/core/http.js'
import { parseListOptions } from '@/core/queryString.js'
import { validateAdvancedQuery, validateId, isValidUuid } from '@/core/validation.js'
import { ServerError } from '@/errors/ServerError.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'

function parseId(raw: string | undefined): string | number {
  validateId(raw)
  if (typeof raw === 'string' && isValidUuid(raw)) return raw
  return typeof raw === 'string' ? parseInt(raw, 10) : raw
}

function filterWritableFields(
  resource: ResourceDefinition,
  data: Record<string, unknown>
): Record<string, unknown> {
  const nonWritable = new Set(
    resource.fields.filter((f) => f.writable === false).map((f) => f.name)
  )
  if (nonWritable.size === 0) return data
  return Object.fromEntries(Object.entries(data).filter(([key]) => !nonWritable.has(key)))
}

export interface CrudApiOptions {
  authStrategy?: AuthStrategy
  queryBuilderPath?: string
  previewQueryBuilderPath?: string
}

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
    return { status: 500, code: 'INTERNAL_ERROR', message: error.message }
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Unknown error' }
}

async function sendError(error: unknown, res: HttpResponse): Promise<void> {
  const { status, code, message, details } = normalizeError(error)
  const item: Record<string, unknown> = { code, message }
  if (details !== undefined) item['details'] = details
  await res.status(status).json({ errors: [item] })
}

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

function getHeaderValue(req: HttpRequest, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()] ?? req.headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : undefined
}

function checkContentType(req: HttpRequest): void {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method.toUpperCase())) return
  const contentType = getHeaderValue(req, 'content-type') ?? ''
  if (contentType && !contentType.includes('application/json')) {
    throw new UnsupportedMediaTypeError()
  }
}

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

export function registerCrudApi(
  server: HttpServer,
  resources: ResourceDefinition[],
  options: CrudApiOptions = {}
): void {
  const authStrategy = options.authStrategy ?? new AllowAllAuthStrategy()
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
          const query = {
            ...queryBody,
            tableName: resource.tableName
          } as IQueryOptions
          validateAdvancedQuery(resource, query)
          const result = await repository.updateMany(query, update as never)
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
          const result = await repository.upsertOne(id, req.body as never)
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
      const query = req.body as IQueryOptions
      await res.status(200).json({
        count: QueryBuilder.buildCountQuery(query),
        select: QueryBuilder.buildSelectQuery(query)
      })
    })
  )
}
