import { AuthenticationError } from '@/errors/AuthenticationError.js'
import type { CrudAction, ResourceDefinition } from '@/core/types.js'
import type { HttpRequest } from '@/core/http.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'

export interface AuthContext {
  userId?: string
  roles?: string[]
  permissions?: string[]
  claims?: Record<string, unknown>
  isAuthenticated: boolean
}

export interface AuthorizeParams {
  auth: AuthContext
  action: CrudAction
  resource: ResourceDefinition
  requiredPermissions: string[]
  req: HttpRequest
}

export interface AuthStrategy {
  authenticate(req: HttpRequest): Promise<AuthContext> | AuthContext
  authorize?(params: AuthorizeParams): Promise<boolean> | boolean
}

export class AllowAllAuthStrategy implements AuthStrategy {
  public authenticate(): AuthContext {
    return { isAuthenticated: true }
  }
}

export class ApiKeyAuthStrategy implements AuthStrategy {
  public constructor(
    private readonly expectedApiKey: string,
    private readonly headerName = 'x-api-key'
  ) {}

  public authenticate(req: HttpRequest): AuthContext {
    const header = req.headers[this.headerName.toLowerCase()] ?? req.headers[this.headerName]
    const apiKey = Array.isArray(header) ? header[0] : header
    if (!apiKey || apiKey !== this.expectedApiKey) {
      throw new AuthorizationError('Invalid API key', 403)
    }
    return { isAuthenticated: true }
  }
}

export class JwtClaimsAuthStrategy implements AuthStrategy {
  public constructor(
    private readonly verifyToken: (
      token: string,
      req: HttpRequest
    ) => Promise<AuthContext> | AuthContext
  ) {}

  public async authenticate(req: HttpRequest): Promise<AuthContext> {
    const header = req.headers.authorization ?? req.headers.Authorization
    const value = Array.isArray(header) ? header[0] : header
    const match = typeof value === 'string' ? value.match(/^Bearer\s+(.+)$/i) : null
    if (!match) {
      throw new AuthenticationError('Missing bearer token')
    }
    return await this.verifyToken(match[1]!, req)
  }

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

export class PassportAuthStrategy implements AuthStrategy {
  public constructor(
    private readonly authenticateWithPassport: (
      req: HttpRequest
    ) => Promise<AuthContext> | AuthContext
  ) {}

  public async authenticate(req: HttpRequest): Promise<AuthContext> {
    return await this.authenticateWithPassport(req)
  }
}

export interface PassportLike {
  authenticate(
    strategy: string,
    options: { session: boolean },
    callback: (err: unknown, user: unknown) => void
  ): (req: unknown, res: unknown, next: (err?: unknown) => void) => void
}

export interface PassportJwtStrategyOptions {
  passport: PassportLike
  strategy?: string
  mapUser?: (user: unknown) => AuthContext
}

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

export class PassportJwtStrategy implements AuthStrategy {
  private readonly passport: PassportLike
  private readonly strategy: string
  private readonly mapUser: (user: unknown) => AuthContext

  public constructor(options: PassportJwtStrategyOptions) {
    this.passport = options.passport
    this.strategy = options.strategy ?? 'jwt'
    this.mapUser = options.mapUser ?? defaultMapUser
  }

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

  public authorize(params: AuthorizeParams): boolean {
    if (!params.requiredPermissions.length) return true
    const permissions = new Set(params.auth.permissions ?? [])
    const roles = new Set(params.auth.roles ?? [])
    return params.requiredPermissions.every((p) => permissions.has(p) || roles.has(p))
  }
}

export class Auth0JwtStrategy extends JwtClaimsAuthStrategy {}
export class FirebaseJwtStrategy extends JwtClaimsAuthStrategy {}

export type AuthProvider = AuthStrategy
export const AllowAllAuthProvider = AllowAllAuthStrategy
export const ApiKeyAuthProvider = ApiKeyAuthStrategy
export const PermissionAuthProvider = JwtClaimsAuthStrategy
