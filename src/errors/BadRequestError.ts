import { HttpError } from './HttpError.js'

/** Thrown when the request is malformed or contains invalid input (HTTP 400). */
export class BadRequestError extends HttpError {
  /**
   * @param message - Human-readable error description (default: `'Bad Request'`).
   * @param details - Optional structured details attached to the response body.
   */
  public constructor(message = 'Bad Request', details?: unknown) {
    super(message, 400, details)
    this.name = 'BadRequestError'
  }
}
