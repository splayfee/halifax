import { HttpError } from './HttpError.js'

export class NotFoundError extends HttpError {
  public constructor(message = 'Not Found', details?: unknown) {
    super(message, 404, details)
    this.name = 'NotFoundError'
  }
}
