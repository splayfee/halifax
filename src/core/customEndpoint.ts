import {
  checkRequiredPermissions,
  type AuthContext,
  type AuthStrategy,
  type CustomAuthorizeParams
} from '@/auth/strategies/types.js'
import type { HttpMethod, HttpRequest, HttpResponse, HttpServer } from '@/core/types.js'
import { wrap } from '@/core/handlerUtils.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'
import { ServerError } from '@/errors/ServerError.js'
import type { OpenApiOperation, OpenApiSpec } from '@/openapi/types.js'
import { runValidation } from '@/core/customEndpointValidation.js'
import type { CustomEndpointSchemas } from '@/core/customEndpointValidation.js'
import { mergeCustomEndpointOpenApi } from '@/core/customEndpointOpenApi.js'

export type { CustomEndpointSchemas }

/** HTTP verbs a custom endpoint may use (excludes the `'*'` catch-all). */
export type CustomEndpointMethod = Exclude<HttpMethod, '*'>

/** Resolved context passed as the third argument to every custom endpoint handler. */
export interface CustomEndpointContext {
  /**
   * The authenticated caller's identity, resolved by the configured auth strategy.
   * For a **public** endpoint (`roles: null` / `auth: false`) this is an unauthenticated
   * context (`{ isAuthenticated: false }`) — the handler owns any further checks.
   */
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
 * Per-endpoint authorization predicate. When provided it is the **sole** authorization gate
 * for the endpoint — it overrides both `roles` matching and the strategy's `authorizeCustom`.
 * Return `false` (or a rejected promise) to deny with 403.
 */
export type CustomEndpointAuthorizer = (ctx: {
  auth: AuthContext
  req: HttpRequest
}) => boolean | Promise<boolean>

/**
 * Optional OpenAPI 3.1 metadata for a custom endpoint. When provided and the API was
 * configured with `openapi: { enabled: true }`, the operation is merged into the live spec
 * so it appears in `/openapi.json` and the Swagger UI immediately after registration.
 */
export interface CustomEndpointOpenApi extends Omit<OpenApiOperation, 'responses'> {
  /** HTTP response descriptions. Defaults to `{ '200': { description: 'OK' } }` when omitted. */
  responses?: OpenApiOperation['responses']
}

/**
 * Options bag form of {@link HalifaxApi.addCustomEndpoint}. Every field is optional; the
 * defaults reproduce the behaviour of the positional `roles`-array call.
 */
export interface CustomEndpointOptions {
  /**
   * Roles/permissions to match (OR logic — any single match grants access).
   * - `[]` or omitted → any **authenticated** caller.
   * - `null` → **public**: authentication is skipped entirely.
   * - `[...]` → the caller must hold at least one listed role/permission.
   */
  roles?: string[] | null
  /**
   * Explicit authentication toggle. `false` makes the endpoint public (equivalent to
   * `roles: null`); the configured strategy's `authenticate` is never called. Defaults to `true`.
   */
  auth?: boolean
  /** One-off authorization predicate. When set it is the sole gate (see {@link CustomEndpointAuthorizer}). */
  authorize?: CustomEndpointAuthorizer
  /**
   * Route role-gating through {@link AuthStrategy.authorizeCustom} when the strategy implements it,
   * so hierarchical / threshold authorization works for custom endpoints exactly as it does for
   * auto-CRUD. Defaults to `true`; set `false` to force the flat OR-match instead.
   */
  useStrategyAuthorize?: boolean
  /** Accepted request `Content-Type`s (e.g. `['multipart/form-data']`). Defaults to `['application/json']`. */
  consumes?: string[]
  /** Response `Content-Type`s negotiated against the `Accept` header. Defaults to `['application/json']`. */
  produces?: string[]
  /**
   * Validator-agnostic schemas for the request `body`, `query`, and/or `params`. Each is validated
   * (and coerced) before the handler runs; on failure the request is rejected with `422`. When a
   * schema can produce a JSON Schema it also auto-documents the endpoint in OpenAPI. See
   * {@link CustomEndpointSchemas}.
   */
  validate?: CustomEndpointSchemas
  /** OpenAPI metadata merged into the live spec. Explicit metadata wins over schema-derived docs. */
  openapi?: CustomEndpointOpenApi
}

/** A custom endpoint config normalized to a single internal shape. */
interface ResolvedCustomEndpoint {
  roles: string[]
  isPublic: boolean
  authorize: CustomEndpointAuthorizer | undefined
  useStrategyAuthorize: boolean
  consumes: string[]
  produces: string[]
  validate: CustomEndpointSchemas | undefined
  openapi: CustomEndpointOpenApi | undefined
}

/** Dependencies a {@link HalifaxApi} hands to {@link registerCustomEndpoint}. */
export interface CustomEndpointDeps {
  server: HttpServer
  authStrategy: AuthStrategy
  registeredRoutes: Set<string>
  liveSpec: OpenApiSpec | null
}

const DEFAULT_CONTENT_TYPES = ['application/json']
const UNAUTHENTICATED: AuthContext = { isAuthenticated: false }

/**
 * Normalizes the two accepted call forms — a positional `roles` array (or `null`) plus an
 * optional `openapi` argument, or a {@link CustomEndpointOptions} object — into one shape.
 */
export function resolveCustomEndpoint(
  rolesOrOptions: string[] | null | CustomEndpointOptions,
  openapi: CustomEndpointOpenApi | undefined
): ResolvedCustomEndpoint {
  const positional = rolesOrOptions === null || Array.isArray(rolesOrOptions)
  const opts: CustomEndpointOptions = positional ? {} : rolesOrOptions
  const roles = positional ? rolesOrOptions : (opts.roles ?? [])
  return {
    roles: Array.isArray(roles) ? roles : [],
    isPublic: roles === null || opts.auth === false,
    authorize: opts.authorize,
    useStrategyAuthorize: opts.useStrategyAuthorize !== false,
    consumes: opts.consumes ?? DEFAULT_CONTENT_TYPES,
    produces: opts.produces ?? DEFAULT_CONTENT_TYPES,
    validate: positional ? undefined : opts.validate,
    openapi: positional ? openapi : opts.openapi
  }
}

/**
 * Enforces authorization for an authenticated custom-endpoint call, in precedence order:
 * 1. a per-endpoint `authorize` predicate (sole gate when present);
 * 2. the strategy's `authorizeCustom` (enables hierarchical / threshold authorization);
 * 3. a flat OR-match of `roles` against the caller's roles/permissions.
 * @throws {@link AuthorizationError} when the caller is not permitted.
 */
async function enforceAuthorization(
  strategy: AuthStrategy,
  endpoint: ResolvedCustomEndpoint,
  params: Omit<CustomAuthorizeParams, 'requiredPermissions'>
): Promise<void> {
  if (endpoint.authorize) {
    if (!(await endpoint.authorize({ auth: params.auth, req: params.req })))
      throw new AuthorizationError()
    return
  }
  if (endpoint.useStrategyAuthorize && strategy.authorizeCustom) {
    const allowed = await strategy.authorizeCustom({
      ...params,
      requiredPermissions: endpoint.roles
    })
    if (!allowed) throw new AuthorizationError()
    return
  }
  if (endpoint.roles.length > 0 && !checkRequiredPermissions(params.auth, endpoint.roles))
    throw new AuthorizationError()
}

/**
 * Registers a custom route that participates in Halifax's content negotiation, auth pipeline,
 * error serialization, and (optionally) live OpenAPI documentation.
 * @throws {@link ServerError} when `method + path` is already registered.
 */
export function registerCustomEndpoint(
  deps: CustomEndpointDeps,
  method: CustomEndpointMethod,
  path: string,
  endpoint: ResolvedCustomEndpoint,
  handler: CustomEndpointHandler
): void {
  const key = `${method}:${path}`
  if (deps.registeredRoutes.has(key))
    throw new ServerError(
      `Cannot register custom endpoint — ${method} ${path} is already registered.`
    )
  deps.registeredRoutes.add(key)

  const { authStrategy } = deps
  deps.server.registerRoute(
    method,
    path,
    wrap(
      async (req, res) => {
        let auth = UNAUTHENTICATED
        if (!endpoint.isPublic) {
          auth = await authStrategy.authenticate(req)
          await enforceAuthorization(authStrategy, endpoint, { auth, method, path, req })
        }
        if (endpoint.validate) await runValidation(endpoint.validate, req)
        await handler(req, res, { auth })
      },
      { consumes: endpoint.consumes, produces: endpoint.produces }
    )
  )

  mergeCustomEndpointOpenApi(deps.liveSpec, method, path, endpoint)
}
