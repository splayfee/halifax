import { HttpError } from './HttpError.js'

export class AuthenticationError extends HttpError {
  public constructor(message = 'Unauthorized', details?: unknown) {
    super(message, 401, details)
    this.name = 'AuthenticationError'
  }
}
