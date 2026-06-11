import { HttpError } from './HttpError.js'

/** Thrown when a repository method or feature is not supported by the current adapter (HTTP 501). */
export class NotImplementedError extends HttpError {
  /**
   * @param message - Human-readable error description (default: `'Not Implemented'`).
   * @param details - Optional structured details attached to the response body.
   */
  public constructor(message = 'Not Implemented', details?: unknown) {
    super(message, 501, details)
    this.name = 'NotImplementedError'
  }
}
