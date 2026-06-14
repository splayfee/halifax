import type { AuthContext, AuthStrategy } from './types.js'

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
