import { HttpError } from './HttpError.js'

export class UnsupportedMediaTypeError extends HttpError {
  public constructor(message = 'Unsupported Media Type', details?: unknown) {
    super(message, 415, details)
    this.name = 'UnsupportedMediaTypeError'
  }
}
