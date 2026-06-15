import type { AuthContext, AuthStrategy } from '@/auth/AuthStrategy.js'
import type { CrudHooks, HookContext, MaybePromise } from '@/core/hooks.js'
import { HttpError } from '@/errors/HttpError.js'
import { NotAcceptableError } from '@/errors/NotAcceptableError.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'
import { UnsupportedMediaTypeError } from '@/errors/UnsupportedMediaTypeError.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'
import { type CrudAction, type ResourceDefinition } from '@/core/types.js'
import type { HttpRequest, HttpResponse, Repository } from '@/core/types.js'
import { validateId, isValidUuid, isValidObjectId } from '@/core/validation.js'

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
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' }
}

/**
 * Serialises a caught error and writes it as a JSON `{ errors: [...] }` response.
 */
export async function sendError(error: unknown, res: HttpResponse): Promise<void> {
  const { status, code, message, details } = normalizeError(error)
  const item: Record<string, unknown> = { code, message }
  if (details !== undefined) item['details'] = details
  await res.status(status).json({ errors: [item] })
}

/**
 * Invokes a data-transforming hook and falls back to `value` when the hook returns void.
 */
export async function applyHook<T>(
  hook: ((value: T, ctx: HookContext) => MaybePromise<T | void>) | undefined,
  value: T,
  ctx: HookContext
): Promise<T> {
  if (!hook) return value
  return (await hook(value, ctx)) ?? value
}

/**
 * Writes a success body as JSON, wrapping it under `envelope` when one is configured.
 */
export function writeSuccess(
  res: HttpResponse,
  status: number,
  body: unknown,
  envelope: string | null
): void | Promise<void> {
  return res.status(status).json(envelope ? { [envelope]: body } : body)
}

/**
 * Parses and validates a raw `:id` route parameter.
 * @throws {@link BadRequestError} when the value is not a valid integer, UUID, or ObjectId.
 */
export function parseId(raw: string | undefined): string | number {
  validateId(raw)
  if (typeof raw === 'string' && (isValidUuid(raw) || isValidObjectId(raw))) return raw
  return typeof raw === 'string' ? parseInt(raw, 10) : raw
}

/**
 * Strips non-writable fields from a request body and rejects unknown fields with a 422.
 * Fields with `writable: false` are dropped; fields gated by `writeRoles` the caller lacks
 * are also dropped.
 * @throws {@link UnprocessableEntityError} for keys not defined on the resource.
 */
export function filterWritableFields(
  resource: ResourceDefinition,
  data: Record<string, unknown>,
  auth?: AuthContext
): Record<string, unknown> {
  const fields = resource.fields ?? []
  const fieldMap = new Map(fields.map((f) => [f.name, f]))
  const unknownFields = Object.keys(data).filter((key) => !fieldMap.has(key))
  if (unknownFields.length) {
    throw new UnprocessableEntityError(`Unknown field(s): ${unknownFields.join(', ')}.`)
  }

  const userRoles = new Set([...(auth?.roles ?? []), ...(auth?.permissions ?? [])])

  return Object.fromEntries(
    Object.entries(data).filter(([key]) => {
      const field = fieldMap.get(key)
      if (field?.writable === false) return false
      if (field?.writeRoles?.length) {
        return field.writeRoles.some((r) => userRoles.has(r))
      }
      return true
    })
  )
}

/**
 * Strips fields the caller is not permitted to read based on per-field `readRoles`.
 * Fast-path returns the record unchanged when no fields carry read restrictions.
 */
export function filterReadableFields(
  resource: ResourceDefinition,
  record: Record<string, unknown>,
  auth?: AuthContext
): Record<string, unknown> {
  const fields = resource.fields ?? []
  if (!fields.some((f) => (f.readRoles?.length ?? 0) > 0)) return record

  const fieldMap = new Map(fields.map((f) => [f.name, f]))
  const userRoles = new Set([...(auth?.roles ?? []), ...(auth?.permissions ?? [])])
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => {
      const field = fieldMap.get(key)
      if (!field?.readRoles?.length) return true
      return field.readRoles.some((r) => userRoles.has(r))
    })
  )
}

/**
 * Runs the auth strategy for `action` and throws {@link AuthorizationError} when not allowed.
 */
export async function authorizeRequest(
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
    const allowed = requiredPermissions.some(
      (permission) => permissions.has(permission) || roles.has(permission)
    )
    if (!allowed) throw new AuthorizationError()
  }
  return auth
}

/**
 * Reads a single header value by name (case-insensitive).
 */
export function getHeaderValue(req: HttpRequest, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()] ?? req.headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : undefined
}

/**
 * Returns true when the request asks to force-refresh the cache.
 * For `Cache-Control` this means a `no-cache`/`no-store` directive; for any custom header,
 * mere presence with a non-empty value triggers the bust.
 */
export function wantsCacheBust(req: HttpRequest, header: string): boolean {
  const value = getHeaderValue(req, header)
  if (!value) return false
  if (header.toLowerCase() === 'cache-control') return /no-cache|no-store/i.test(value)
  return true
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

/**
 * Wraps a route handler with Content-Type / Accept checks, error serialisation,
 * and `X-Correlation-ID` echo-back.
 */
export function wrap(handler: (req: HttpRequest, res: HttpResponse) => Promise<void>) {
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

/** Shared context passed to every route-handler registration function. */
export interface RouteHandlerContext {
  resource: ResourceDefinition
  authStrategy: AuthStrategy
  envelope: string | null
  hooks:
    | CrudHooks<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>
    | undefined
  resolveRepo: (req: HttpRequest, auth: AuthContext) => Promise<Repository>
}
