import type { HttpRequest } from '@/core/types.js'
import type { AuthContext, AuthStrategy } from './types.js'

/** Passes every request through without any authentication checks. Useful for public APIs or testing. */
export class AllowAllAuthStrategy implements AuthStrategy {
  public authenticate(_req: HttpRequest): AuthContext {
    return { isAuthenticated: true }
  }
}
