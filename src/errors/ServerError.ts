import { HttpError } from './HttpError.js'

export class ServerError extends HttpError {
  public constructor(message = 'Server error', details?: unknown) {
    super(message, 500, details)
    this.name = 'ServerError'
  }
}
