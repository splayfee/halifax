import { AuthenticationError } from '@/errors/AuthenticationError.js'
import type { HttpRequest } from '@/core/types.js'
import { checkRequiredPermissions } from './types.js'
import type { AuthContext, AuthorizeParams, AuthStrategy, SecurityScheme } from './types.js'

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
    return checkRequiredPermissions(params.auth, params.requiredPermissions)
  }

  public openApiScheme(): SecurityScheme {
    return { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
  }
}

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
    return checkRequiredPermissions(params.auth, params.requiredPermissions)
  }

  public openApiScheme(): SecurityScheme {
    return {
      type: 'apiKey',
      in: 'cookie',
      name: 'connect.sid',
      description: 'Passport session cookie.'
    }
  }
}
