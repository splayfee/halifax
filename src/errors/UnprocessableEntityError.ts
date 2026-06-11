import { HttpError } from './HttpError.js'

/** Thrown when request syntax is valid but the content fails business validation (HTTP 422). */
export class UnprocessableEntityError extends HttpError {
  /**
   * @param message - Human-readable error description (default: `'Unprocessable Entity'`).
   * @param details - Optional structured details attached to the response body.
   */
  public constructor(message = 'Unprocessable Entity', details?: unknown) {
    super(message, 422, details)
    this.name = 'UnprocessableEntityError'
  }
}
