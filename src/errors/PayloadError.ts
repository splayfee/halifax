import { HttpError } from './HttpError.js'

export class PayloadError extends HttpError {
  public constructor(message = 'Invalid payload', details?: unknown) {
    super(message, 400, details)
    this.name = 'PayloadError'
  }
}
