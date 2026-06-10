import { AllowAllAuthStrategy, type AuthStrategy } from '@/auth/AuthStrategy.js'
import { QueryBuilder } from '@/classes/QueryBuilder.js'
import { HttpError } from '@/errors/HttpError.js'
import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'
import { defaultCrudPermissions, type CrudAction, type ResourceDefinition } from '@/core/types.js'
import type { HttpRequest, HttpResponse, HttpServer } from '@/core/http.js'
import { parseListOptions } from '@/core/queryString.js'
import { validateAdvancedQuery, validateId, isValidUuid } from '@/core/validation.js'
import { ServerError } from '@/index.js'
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

export function normalizeError(error: unknown): {
  status: number
  name: string
  message: string
  details?: unknown
} {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      name: error.name,
      message: error.message,
      details: error.details
    }
  }
  if (error instanceof Error) {
    return { status: 500, name: error.name, message: error.message }
  }
  return { status: 500, name: 'Error', message: 'Unknown error' }
}

async function sendError(error: unknown, res: HttpResponse): Promise<void> {
  const normalized = normalizeError(error)
  await res.status(normalized.status).json({ error: normalized })
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
    if (!allowed) throw new AuthorizationError('Forbidden', 403)
    return
  }

  if (requiredPermissions.length) {
    const permissions = new Set(auth.permissions ?? [])
    const roles = new Set(auth.roles ?? [])
    const allowed = requiredPermissions.every(
      (permission) => permissions.has(permission) || roles.has(permission)
    )
    if (!allowed) throw new AuthorizationError('Forbidden', 403)
  }
}

function getHeaderValue(req: HttpRequest, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()] ?? req.headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : undefined
}

function checkAcceptHeader(req: HttpRequest): void {
  const accept = getHeaderValue(req, 'accept') ?? ''
  if (
    accept &&
    !accept.includes('*/*') &&
    !accept.includes('application/*') &&
    !accept.includes('application/json')
  ) {
    throw new HttpError('Not Acceptable', 406)
  }
}

function wrap(handler: (req: HttpRequest, res: HttpResponse) => Promise<void>) {
  return async (req: HttpRequest, res: HttpResponse): Promise<void> => {
    const correlationId = getHeaderValue(req, 'x-correlation-id')
    if (correlationId) res.setHeader?.('X-Correlation-ID', correlationId)
    try {
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
      throw new ServerError(`Resource '${resource.name}' does not define a repository.`, 500)

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
            throw new ServerError('This resource does not support the query builder.', 501)
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
          if (!result) {
            await res.status(404).json({ error: { message: 'Not found' } })
            return
          }
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
          if (!result) {
            await res.status(404).json({ error: { message: 'Not found' } })
            return
          }
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
            throw new ServerError('This resource does not support updateMany.', 501)
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
            throw new ServerError('This resource does not support upsert.', 501)
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
          if (!deleted) {
            await res.status(404).json({ error: { message: 'Not found' } })
            return
          }
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
            throw new ServerError('This resource does not support deleteMany.', 501)
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
