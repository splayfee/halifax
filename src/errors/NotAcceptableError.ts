import { HttpError } from './HttpError.js'

/** Thrown when the client's Accept header cannot be satisfied (HTTP 406). */
export class NotAcceptableError extends HttpError {
  /**
   * @param message - Human-readable error description (default: `'Not Acceptable'`).
   * @param details - Optional structured details attached to the response body.
   */
  public constructor(message = 'Not Acceptable', details?: unknown) {
    super(message, 406, details)
    this.name = 'NotAcceptableError'
  }
}
