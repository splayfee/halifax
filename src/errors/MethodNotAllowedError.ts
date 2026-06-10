import { HttpError } from './HttpError.js'

export class MethodNotAllowedError extends HttpError {
  public constructor(message = 'Method Not Allowed', details?: unknown) {
    super(message, 405, details)
    this.name = 'MethodNotAllowedError'
  }
}
