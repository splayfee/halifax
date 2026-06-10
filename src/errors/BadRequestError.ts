import { HttpError } from './HttpError.js'

export class BadRequestError extends HttpError {
  public constructor(message = 'Bad Request', details?: unknown) {
    super(message, 400, details)
    this.name = 'BadRequestError'
  }
}
