import { HttpError } from './HttpError.js'

export class NotAcceptableError extends HttpError {
  public constructor(message = 'Not Acceptable', details?: unknown) {
    super(message, 406, details)
    this.name = 'NotAcceptableError'
  }
}
