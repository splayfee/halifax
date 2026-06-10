import { HttpError } from './HttpError.js'

export class UnprocessableEntityError extends HttpError {
  public constructor(message = 'Unprocessable Entity', details?: unknown) {
    super(message, 422, details)
    this.name = 'UnprocessableEntityError'
  }
}
