import { AuthenticationError } from '@/errors/AuthenticationError.js'
import type { HttpRequest } from '@/core/types.js'
import {
  checkRequiredPermissions,
  type AuthContext,
  type AuthorizeParams,
  type AuthStrategy,
  type CustomAuthorizeParams,
  type SecurityScheme
} from './types.js'

/**
 * Combines several auth strategies into one, trying each in order and adopting the **first**
 * that authenticates the request. This is how you support a route reachable by more than one
 * credential — e.g. an interactive **session** *or* a programmatic **API key** (with its scopes
 * mapped to `auth.permissions`).
 *
 * Authorization (`authorize` / `authorizeCustom`) and the OpenAPI security scheme are delegated
 * to the strategy that actually authenticated the request, so each credential keeps its own
 * authorization rules. When that strategy implements neither method, a flat `requiredPermissions`
 * OR-match is used — identical to Halifax's default behaviour.
 *
 * @example
 * ```ts
 * const authStrategy = new CompositeAuthStrategy([
 *   new ApiKeyAuthStrategy(process.env.API_KEY!, 'x-api-key', ['devices:read']),
 *   new PassportSessionStrategy()
 * ])
 * ```
 */
export class CompositeAuthStrategy implements AuthStrategy {
  /**
   * Maps each request's resolved {@link AuthContext} back to the strategy that produced it, so
   * `authorize`/`authorizeCustom` can delegate to the right one. A `WeakMap` keyed on the
   * per-request auth object means entries are reclaimed automatically once the request is done.
   */
  private readonly winner = new WeakMap<AuthContext, AuthStrategy>()

  /**
   * @param strategies - Strategies to try, in priority order (first match wins).
   * @throws {@link Error} when the list is empty.
   */
  public constructor(private readonly strategies: AuthStrategy[]) {
    if (strategies.length === 0)
      throw new Error('CompositeAuthStrategy requires at least one strategy.')
  }

  /**
   * Authenticates by trying each strategy in order, returning the first success.
   * @param req - The incoming HTTP request.
   * @returns The {@link AuthContext} from the first strategy that authenticates the request.
   * @throws The last error raised when **no** strategy authenticates the request.
   */
  public async authenticate(req: HttpRequest): Promise<AuthContext> {
    let lastError: unknown = new AuthenticationError(
      'No authentication strategy matched the request.'
    )
    for (const strategy of this.strategies) {
      try {
        const auth = await strategy.authenticate(req)
        this.winner.set(auth, strategy)
        return auth
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  /** Delegates to the authenticating strategy's `authorize`, or a flat permission match. */
  public authorize(params: AuthorizeParams): boolean | Promise<boolean> {
    const strategy = this.winner.get(params.auth)
    if (strategy?.authorize) return strategy.authorize(params)
    return checkRequiredPermissions(params.auth, params.requiredPermissions)
  }

  /** Delegates to the authenticating strategy's `authorizeCustom`, or a flat permission match. */
  public authorizeCustom(params: CustomAuthorizeParams): boolean | Promise<boolean> {
    const strategy = this.winner.get(params.auth)
    if (strategy?.authorizeCustom) return strategy.authorizeCustom(params)
    return checkRequiredPermissions(params.auth, params.requiredPermissions)
  }

  /** Returns the first security scheme any member strategy declares (for OpenAPI docs). */
  public openApiScheme(): SecurityScheme | undefined {
    for (const strategy of this.strategies) {
      const scheme = strategy.openApiScheme?.()
      if (scheme) return scheme
    }
    return undefined
  }
}
