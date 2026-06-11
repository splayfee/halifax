import { HttpError } from './HttpError.js'

/** Thrown when an authenticated user lacks permission for an action (HTTP 403). */
export class AuthorizationError extends HttpError {
  /**
   * @param message - Human-readable error description (default: `'Forbidden'`).
   * @param details - Optional structured details attached to the response body.
   */
  public constructor(message = 'Forbidden', details?: unknown) {
    super(message, 403, details)
    this.name = 'AuthorizationError'
  }
}
