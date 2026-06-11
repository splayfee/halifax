/** Base class for all HTTP errors. Carries a status code and optional structured details. */
export abstract class HttpError extends Error {
  public readonly status: number
  public readonly details?: unknown

  /**
   * @param message - Human-readable error description included in the response body.
   * @param status - HTTP status code sent to the client.
   * @param details - Optional structured details attached to the response body.
   */
  public constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.details = details
  }
}
