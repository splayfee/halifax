import { HttpError } from './HttpError.js'

/** Thrown when a write conflicts with an existing record — e.g. a duplicate unique field (HTTP 409). */
export class ConflictError extends HttpError {
  public constructor(message = 'Conflict', details?: unknown) {
    super(message, 409, details)
    this.name = 'ConflictError'
  }
}
