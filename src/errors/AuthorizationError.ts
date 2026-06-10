import { HttpError } from './HttpError.js'

export class AuthorizationError extends HttpError {
  public constructor(message = 'Forbidden', details?: unknown) {
    super(message, 403, details)
    this.name = 'AuthorizationError'
  }
}
