import { HttpError } from './HttpError.js'

/** Thrown when the request body Content-Type is not application/json (HTTP 415). */
export class UnsupportedMediaTypeError extends HttpError {
  /**
   * @param message - Human-readable error description (default: `'Unsupported Media Type'`).
   * @param details - Optional structured details attached to the response body.
   */
  public constructor(message = 'Unsupported Media Type', details?: unknown) {
    super(message, 415, details)
    this.name = 'UnsupportedMediaTypeError'
  }
}
