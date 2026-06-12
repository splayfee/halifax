import { AuthenticationError } from '@/errors/AuthenticationError.js'
import type { CrudAction, ResourceDefinition } from '@/core/types.js'
import type { HttpRequest } from '@/core/types.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'

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
}

/** Passes every request through without any authentication checks. Useful for public APIs or testing. */
export class AllowAllAuthStrategy implements AuthStrategy {
  /**
   * Always returns an authenticated context with no user details.
   * @returns An {@link AuthContext} with `isAuthenticated: true`.
   */
  public authenticate(): AuthContext {
    return { isAuthenticated: true }
  }
}

/** Validates a static API key carried in a request header. */
export class ApiKeyAuthStrategy implements AuthStrategy {
  /**
   * @param expectedApiKey - The secret key that callers must supply.
   * @param headerName - Header to read the key from (default: `x-api-key`).
   */
  public constructor(
    private readonly expectedApiKey: string,
    private readonly headerName = 'x-api-key'
  ) {}

  /**
   * Checks the API key header and returns an authenticated context.
   * @param req - The incoming HTTP request.
   * @returns An {@link AuthContext} with `isAuthenticated: true`.
   * @throws {@link AuthenticationError} when the key is absent (401).
   * @throws {@link AuthorizationError} when the key is present but incorrect (403).
   */
  public authenticate(req: HttpRequest): AuthContext {
    const header = req.headers[this.headerName.toLowerCase()] ?? req.headers[this.headerName]
    const apiKey = Array.isArray(header) ? header[0] : header
    if (!apiKey) throw new AuthenticationError('Missing API key')
    if (apiKey !== this.expectedApiKey) throw new AuthorizationError('Invalid API key')
    return { isAuthenticated: true }
  }
}

/** Authenticates via a Bearer JWT and authorises using roles/permissions embedded in its claims. */
export class JwtClaimsAuthStrategy implements AuthStrategy {
  /**
   * @param verifyToken - Callback that verifies the JWT string and resolves to an {@link AuthContext}.
   *   Throw to signal an invalid token.
   */
  public constructor(
    private readonly verifyToken: (
      token: string,
      req: HttpRequest
    ) => Promise<AuthContext> | AuthContext
  ) {}

  /**
   * Extracts and verifies the Bearer token from the `Authorization` header.
   * @param req - The incoming HTTP request.
   * @returns The resolved {@link AuthContext} from the token verifier.
   * @throws {@link AuthenticationError} when the token is missing or invalid.
   */
  public async authenticate(req: HttpRequest): Promise<AuthContext> {
    const header = req.headers.authorization ?? req.headers.Authorization
    const value = Array.isArray(header) ? header[0] : header
    const match = typeof value === 'string' ? value.match(/^Bearer\s+(.+)$/i) : null
    if (!match) {
      throw new AuthenticationError('Missing bearer token')
    }
    return await this.verifyToken(match[1]!, req)
  }

  /**
   * Returns `true` when the auth context satisfies all required permissions.
   * Checks both `permissions` and `roles` arrays against each required permission string.
   * @param params - Authorization context including required permissions and the resolved auth.
   * @returns `true` when all required permissions are satisfied, `false` otherwise.
   */
  public authorize(params: AuthorizeParams): boolean {
    if (!params.requiredPermissions.length) {
      return true
    }
    const permissions = new Set(params.auth.permissions ?? [])
    const roles = new Set(params.auth.roles ?? [])
    return params.requiredPermissions.every((permission) => {
      return permissions.has(permission) || roles.has(permission)
    })
  }
}

/** Delegates authentication to a caller-provided Passport authenticate wrapper. */
export class PassportAuthStrategy implements AuthStrategy {
  /**
   * @param authenticateWithPassport - Function that calls your Passport strategy
   *   and resolves to an {@link AuthContext}.
   */
  public constructor(
    private readonly authenticateWithPassport: (
      req: HttpRequest
    ) => Promise<AuthContext> | AuthContext
  ) {}

  /**
   * Delegates to the provided Passport authenticate wrapper.
   * @param req - The incoming HTTP request.
   * @returns The {@link AuthContext} resolved by the wrapper.
   */
  public async authenticate(req: HttpRequest): Promise<AuthContext> {
    return await this.authenticateWithPassport(req)
  }
}

/** Minimal structural interface for a Passport.js instance (avoids a hard dependency on `passport`). */
export interface PassportLike {
  /**
   * Authenticates a request using the named strategy.
   * @param strategy - Name of the registered Passport strategy.
   * @param options - Authentication options (e.g. `{ session: false }`).
   * @param callback - Called with the error or authenticated user on completion.
   * @returns An Express-style middleware function that drives the authentication flow.
   */
  authenticate(
    strategy: string,
    options: { session: boolean },
    callback: (err: unknown, user: unknown) => void
  ): (req: unknown, res: unknown, next: (err?: unknown) => void) => void
}

/** Options for {@link PassportJwtStrategy}. */
export interface PassportJwtStrategyOptions {
  /** A Passport instance with a JWT strategy registered. */
  passport: PassportLike
  /** Name of the Passport strategy to invoke (default: `'jwt'`). */
  strategy?: string
  /** Maps the raw Passport user payload to an {@link AuthContext}. Defaults to reading `sub`/`id`, `roles`, and `permissions`. */
  mapUser?: (user: unknown) => AuthContext
}

/**
 * Extracts `userId`, `roles`, `permissions`, and `claims` from a raw Passport user payload.
 * @param user - The raw user object returned by Passport (typically a decoded JWT payload).
 * @returns A fully populated {@link AuthContext}.
 */
function defaultMapUser(user: unknown): AuthContext {
  const p = (user ?? {}) as Record<string, unknown>
  const userId = typeof p.sub === 'string' ? p.sub : typeof p.id === 'string' ? p.id : undefined
  const ctx: AuthContext = {
    isAuthenticated: true,
    roles: Array.isArray(p.roles) ? (p.roles as string[]) : [],
    permissions: Array.isArray(p.permissions) ? (p.permissions as string[]) : [],
    claims: p
  }
  if (userId !== undefined) ctx.userId = userId
  return ctx
}

/** Authenticates via Passport's JWT strategy, invoking it programmatically without Express middleware. */
export class PassportJwtStrategy implements AuthStrategy {
  private readonly passport: PassportLike
  private readonly strategy: string
  private readonly mapUser: (user: unknown) => AuthContext

  /** @param options - Passport instance, optional strategy name, and optional user mapper. */
  public constructor(options: PassportJwtStrategyOptions) {
    this.passport = options.passport
    this.strategy = options.strategy ?? 'jwt'
    this.mapUser = options.mapUser ?? defaultMapUser
  }

  /**
   * Runs the Passport JWT authenticate handler and resolves to an {@link AuthContext}.
   * @param req - The incoming HTTP request (must carry a `raw` property for Passport to read).
   * @returns The resolved {@link AuthContext}.
   * @throws {@link AuthenticationError} when Passport rejects the token or returns no user.
   */
  public async authenticate(req: HttpRequest): Promise<AuthContext> {
    return new Promise((resolve, reject) => {
      const handler = this.passport.authenticate(
        this.strategy,
        { session: false },
        (err: unknown, user: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new AuthenticationError(String(err)))
            return
          }
          if (!user) {
            reject(new AuthenticationError('Unauthorized'))
            return
          }
          resolve(this.mapUser(user))
        }
      )
      handler(req.raw, {}, (err?: unknown) => {
        if (err) reject(err instanceof Error ? err : new AuthenticationError(String(err)))
      })
    })
  }

  /**
   * Returns `true` when the auth context satisfies all required permissions.
   * @param params - Authorization context including required permissions and the resolved auth.
   * @returns `true` when all required permissions are satisfied, `false` otherwise.
   */
  public authorize(params: AuthorizeParams): boolean {
    if (!params.requiredPermissions.length) return true
    const permissions = new Set(params.auth.permissions ?? [])
    const roles = new Set(params.auth.roles ?? [])
    return params.requiredPermissions.every((p) => permissions.has(p) || roles.has(p))
  }
}

/** Authenticates via Auth0-issued JWTs. Alias of {@link JwtClaimsAuthStrategy}. */
export class Auth0JwtStrategy extends JwtClaimsAuthStrategy {}

/** Authenticates via Firebase ID tokens. Alias of {@link JwtClaimsAuthStrategy}. */
export class FirebaseJwtStrategy extends JwtClaimsAuthStrategy {}

/**
 * Authenticates using Passport session cookies.
 *
 * Passport's session middleware must run before Halifax and populate `req.user`
 * automatically — this strategy simply reads that value and maps it to an
 * {@link AuthContext}. No passport instance is needed here.
 *
 * Prerequisites (add to your Express app before mounting Halifax):
 * ```ts
 * app.use(session({ ... }))
 * app.use(passport.initialize())
 * app.use(passport.session())
 * ```
 */
export class PassportSessionStrategy implements AuthStrategy {
  private readonly mapUser: (user: unknown) => AuthContext

  /** @param mapUser - Optional function to convert the raw session user to an {@link AuthContext}. */
  public constructor(mapUser?: (user: unknown) => AuthContext) {
    this.mapUser = mapUser ?? defaultMapUser
  }

  /**
   * Reads `req.raw.user` (set by Passport session middleware) and maps it to an {@link AuthContext}.
   * @param req - The incoming HTTP request whose `raw.user` property holds the session user.
   * @returns The mapped {@link AuthContext}.
   * @throws {@link AuthenticationError} when `req.raw.user` is absent (not authenticated).
   */
  public authenticate(req: HttpRequest): AuthContext {
    const user = req.raw != null ? (req.raw as Record<string, unknown>)['user'] : undefined
    if (!user) throw new AuthenticationError('Not authenticated')
    return this.mapUser(user)
  }

  /**
   * Returns `true` when the auth context satisfies all required permissions.
   * @param params - Authorization context including required permissions and the resolved auth.
   * @returns `true` when all required permissions are satisfied, `false` otherwise.
   */
  public authorize(params: AuthorizeParams): boolean {
    if (!params.requiredPermissions.length) return true
    const permissions = new Set(params.auth.permissions ?? [])
    const roles = new Set(params.auth.roles ?? [])
    return params.requiredPermissions.every((p) => permissions.has(p) || roles.has(p))
  }
}
