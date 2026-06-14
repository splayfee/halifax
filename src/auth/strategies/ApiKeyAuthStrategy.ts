import { AuthenticationError } from '@/errors/AuthenticationError.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'
import type { HttpRequest } from '@/core/types.js'
import type { AuthContext, AuthStrategy, SecurityScheme } from './types.js'

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

  public openApiScheme(): SecurityScheme {
    return { type: 'apiKey', in: 'header', name: this.headerName }
  }
}
