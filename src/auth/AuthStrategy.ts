import { AuthError } from '../errors/AuthError.js'
import { CrudAction, ResourceDefinition } from '../core/types.js'
import { HttpRequest } from '../core/http.js'

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
      throw new AuthError('Invalid API key', 403)
    }
    return { isAuthenticated: true }
  }
}

export class JwtClaimsAuthStrategy implements AuthStrategy {
  public constructor(
    private readonly verifyToken: (token: string, req: HttpRequest) => Promise<AuthContext> | AuthContext
  ) {}

  public async authenticate(req: HttpRequest): Promise<AuthContext> {
    const header = req.headers.authorization ?? req.headers.Authorization
    const value = Array.isArray(header) ? header[0] : header
    const match = typeof value === 'string' ? value.match(/^Bearer\s+(.+)$/i) : null
    if (!match) {
      throw new AuthError('Missing bearer token')
    }
    return await this.verifyToken(match[1], req)
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
    private readonly authenticateWithPassport: (req: HttpRequest) => Promise<AuthContext> | AuthContext
  ) {}

  public async authenticate(req: HttpRequest): Promise<AuthContext> {
    return await this.authenticateWithPassport(req)
  }
}

export class Auth0JwtStrategy extends JwtClaimsAuthStrategy {}
export class FirebaseJwtStrategy extends JwtClaimsAuthStrategy {}

export type AuthProvider = AuthStrategy
export const AllowAllAuthProvider = AllowAllAuthStrategy
export const ApiKeyAuthProvider = ApiKeyAuthStrategy
export const PermissionAuthProvider = JwtClaimsAuthStrategy
