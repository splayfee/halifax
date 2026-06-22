import type { AuthContext, AuthStrategy } from '@/auth/AuthStrategy.js'
import type { CrudHooks, HookContext, MaybePromise } from '@/core/hooks.js'
import { NotAcceptableError } from '@/errors/NotAcceptableError.js'
import { UnsupportedMediaTypeError } from '@/errors/UnsupportedMediaTypeError.js'
import { type CrudAction, type ResourceDefinition } from '@/core/types.js'
import type { HttpRequest, HttpResponse, Repository } from '@/core/types.js'
import { validateId, isValidUuid, isValidObjectId } from '@/core/validation.js'
import { sendError } from '@/core/errorUtils.js'

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
  if (isValidUuid(raw) || isValidObjectId(raw)) return raw
  return parseInt(raw, 10)
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

/** Per-route content-negotiation config. Both default to `['application/json']`. */
export interface ContentNegotiation {
  /** Request body content types the route accepts (matched against `Content-Type`). */
  consumes?: string[]
  /** Response content types the route produces (matched against `Accept`). */
  produces?: string[]
}

const JSON_ONLY = ['application/json']
const BODY_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE']

/**
 * Rejects a request body whose `Content-Type` is not among the route's accepted types.
 * A request with no body or no `Content-Type` header always passes, and a wildcard entry
 * (the `any` media-type) in `consumes` accepts anything.
 */
function checkContentType(req: HttpRequest, consumes: string[] = JSON_ONLY): void {
  if (!BODY_METHODS.includes(req.method.toUpperCase())) return
  const contentType = getHeaderValue(req, 'content-type') ?? ''
  if (!contentType || consumes.includes('*/*')) return
  if (!consumes.some((type) => contentType.includes(type))) throw new UnsupportedMediaTypeError()
}

/**
 * Rejects a request whose `Accept` header cannot be satisfied by any type the route produces.
 * An absent or `any` (`star-slash-star`) `Accept` passes, as does a matching media-type family
 * wildcard (e.g. `application` followed by `/` then `*` matches `application/json`).
 */
function checkAcceptHeader(req: HttpRequest, produces: string[] = JSON_ONLY): void {
  const accept = getHeaderValue(req, 'accept') ?? ''
  if (!accept || accept.includes('*/*')) return
  const satisfied = produces.some((type) => {
    const family = type.slice(0, type.indexOf('/'))
    return accept.includes(type) || (family !== '' && accept.includes(`${family}/*`))
  })
  if (!satisfied) throw new NotAcceptableError()
}

/**
 * Wraps a route handler with Content-Type / Accept checks, error serialisation,
 * and `X-Correlation-ID` echo-back. Pass {@link ContentNegotiation} to accept/produce
 * content types other than the default `application/json` (e.g. file uploads, binary downloads).
 */
export function wrap(
  handler: (req: HttpRequest, res: HttpResponse) => Promise<void>,
  negotiation?: ContentNegotiation
) {
  return async (req: HttpRequest, res: HttpResponse): Promise<void> => {
    const correlationId = getHeaderValue(req, 'x-correlation-id')
    if (correlationId) res.setHeader?.('X-Correlation-ID', correlationId)
    try {
      checkContentType(req, negotiation?.consumes)
      checkAcceptHeader(req, negotiation?.produces)
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
  resolveRepo: (req: HttpRequest, auth: AuthContext, action: CrudAction) => Promise<Repository>
}
