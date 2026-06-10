export class HttpError extends Error {
  public readonly status: number
  public readonly details?: unknown

  public constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.details = details
  }
}
