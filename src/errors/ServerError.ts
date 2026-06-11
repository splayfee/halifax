import { HttpError } from './HttpError.js'

/** Thrown for unexpected internal failures (HTTP 500). */
export class ServerError extends HttpError {
  /**
   * @param message - Human-readable error description (default: `'Server error'`).
   * @param details - Optional structured details attached to the response body.
   */
  public constructor(message = 'Server error', details?: unknown) {
    super(message, 500, details)
    this.name = 'ServerError'
  }
}
