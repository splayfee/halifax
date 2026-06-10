import { HttpError } from './HttpError.js'

export class NotImplementedError extends HttpError {
  public constructor(message = 'Not Implemented', details?: unknown) {
    super(message, 501, details)
    this.name = 'NotImplementedError'
  }
}
