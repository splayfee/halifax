import { AuthenticationError } from '@/errors/AuthenticationError.js'
import type { HttpRequest } from '@/core/types.js'
import type { AuthContext, AuthorizeParams, AuthStrategy, SecurityScheme } from './types.js'

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

  public openApiScheme(): SecurityScheme {
    return { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
  }
}

/** Authenticates via Auth0-issued JWTs. Alias of {@link JwtClaimsAuthStrategy}. */
export class Auth0JwtStrategy extends JwtClaimsAuthStrategy {}

/** Authenticates via Firebase ID tokens. Alias of {@link JwtClaimsAuthStrategy}. */
export class FirebaseJwtStrategy extends JwtClaimsAuthStrategy {}
