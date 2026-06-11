import { HttpError } from './HttpError.js'

/** Thrown when the HTTP method is not permitted on this route (HTTP 405). */
export class MethodNotAllowedError extends HttpError {
  /**
   * @param message - Human-readable error description (default: `'Method Not Allowed'`).
   * @param details - Optional structured details attached to the response body.
   */
  public constructor(message = 'Method Not Allowed', details?: unknown) {
    super(message, 405, details)
    this.name = 'MethodNotAllowedError'
  }
}
