import { HttpError } from './HttpError.js'

/** Thrown when a request cannot be authenticated (HTTP 401). */
export class AuthenticationError extends HttpError {
  /**
   * @param message - Human-readable error description (default: `'Unauthorized'`).
   * @param details - Optional structured details attached to the response body.
   */
  public constructor(message = 'Unauthorized', details?: unknown) {
    super(message, 401, details)
    this.name = 'AuthenticationError'
  }
}
