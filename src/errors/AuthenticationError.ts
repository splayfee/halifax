import { HttpError } from './HttpError.js'

export class AuthenticationError extends HttpError {
  public constructor(message = 'Unauthorized', status = 401, details?: unknown) {
    super(message, status, details)
    this.name = 'AuthenticationError'
  }
}
