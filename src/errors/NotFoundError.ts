import { HttpError } from './HttpError.js'

/** Thrown when a requested resource does not exist (HTTP 404). */
export class NotFoundError extends HttpError {
  /**
   * @param message - Human-readable error description (default: `'Not Found'`).
   * @param details - Optional structured details attached to the response body.
   */
  public constructor(message = 'Not Found', details?: unknown) {
    super(message, 404, details)
    this.name = 'NotFoundError'
  }
}
