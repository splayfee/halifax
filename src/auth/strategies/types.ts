import type { CrudAction, HttpRequest, ResourceDefinition } from '@/core/types.js'

/** Resolved user identity and access information returned by {@link AuthStrategy.authenticate}. */
export interface AuthContext {
  /** Unique identifier for the authenticated user. */
  userId?: string
  /** Roles granted to the user (checked against `requiredPermissions`). */
  roles?: string[]
  /** Explicit permission strings granted to the user. */
  permissions?: string[]
  /** Raw claims from the token or session payload. */
  claims?: Record<string, unknown>
  /** Always `true` for a successfully authenticated context. */
  isAuthenticated: boolean
}

/** Parameters passed to {@link AuthStrategy.authorize}. */
export interface AuthorizeParams {
  /** The resolved authentication context for the current request. */
  auth: AuthContext
  /** The CRUD action being performed. */
  action: CrudAction
  /** The resource being accessed. */
  resource: ResourceDefinition
  /** Permissions required for this action on this resource. */
  requiredPermissions: string[]
  /** The incoming request. */
  req: HttpRequest
}

/**
 * An OpenAPI 3.1 security scheme descriptor returned by {@link AuthStrategy.openApiScheme}.
 * The spec generator uses this to populate `components/securitySchemes` and the global
 * `security` requirement — so the Swagger UI "Authorize" button works out of the box.
 */
export type SecurityScheme =
  | { type: 'apiKey'; in: 'header' | 'query' | 'cookie'; name: string; description?: string }
  | { type: 'http'; scheme: 'bearer'; bearerFormat?: string; description?: string }
  | { type: 'http'; scheme: 'basic'; description?: string }

/**
 * Checks whether an auth context satisfies `requiredPermissions`.
 * Semantics: **any single match** in `auth.permissions` OR `auth.roles` grants access
 * (i.e. the list is an OR — "user must have at least one of these"). This mirrors
 * the documented behaviour of `FieldDefinition.readRoles` / `writeRoles`.
 */
export function checkRequiredPermissions(
  auth: AuthContext,
  requiredPermissions: string[]
): boolean {
  if (!requiredPermissions.length) return true
  const permissions = new Set(auth.permissions ?? [])
  const roles = new Set(auth.roles ?? [])
  return requiredPermissions.some((p) => permissions.has(p) || roles.has(p))
}

/** Contract for pluggable authentication and authorisation strategies. */
export interface AuthStrategy {
  /**
   * Authenticate the request and return the caller's identity.
   * @param req - The incoming HTTP request.
   * @returns The resolved {@link AuthContext}, or a promise that resolves to one.
   * @throws {@link AuthenticationError} when the request cannot be authenticated.
   */
  authenticate(req: HttpRequest): Promise<AuthContext> | AuthContext
  /**
   * Determine whether the authenticated caller may perform `action`.
   * @param params - Authorization context including the auth, action, resource, and required permissions.
   * @returns `true` to allow, `false` to deny.
   */
  authorize?(params: AuthorizeParams): Promise<boolean> | boolean
  /**
   * Describes this strategy's security scheme for OpenAPI spec generation.
   * When implemented, the spec generator automatically wires up `components/securitySchemes`
   * and the global `security` requirement — no manual `OpenApiOptions.securityScheme` needed.
   * Return `undefined` (or omit the method) for unauthenticated / custom strategies.
   */
  openApiScheme?(): SecurityScheme | undefined
}
