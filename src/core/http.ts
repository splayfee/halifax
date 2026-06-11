/** HTTP methods supported by Halifax routes. `'*'` matches any method (used for 405 fallbacks). */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | '*'

/** Framework-agnostic representation of an incoming HTTP request. */
export interface HttpRequest<TRaw = unknown> {
  method: string
  params: Record<string, string>
  query: Record<string, unknown>
  body: unknown
  headers: Record<string, string | string[] | undefined>
  /** The underlying raw request object from the HTTP framework (e.g. Express `Request`). */
  raw: TRaw
}

/** Framework-agnostic representation of an outgoing HTTP response. */
export interface HttpResponse<TRaw = unknown> {
  /**
   * Set the HTTP status code. Returns `this` for chaining.
   * @param code - HTTP status code to send (e.g. `200`, `404`).
   * @returns This response object for method chaining.
   */
  status(code: number): HttpResponse<TRaw>
  /**
   * Serialize `payload` as JSON and send it as the response body.
   * @param payload - Value to serialize and send.
   */
  json(payload: unknown): void | Promise<void>
  /**
   * Send a raw response body.
   * @param payload - Raw body to send.
   */
  send?(payload?: unknown): void | Promise<void>
  /**
   * Set a response header.
   * @param name - Header name (e.g. `'Content-Type'`).
   * @param value - Header value.
   */
  setHeader?(name: string, value: string): void
  /** The underlying raw response object from the HTTP framework (e.g. Express `Response`). */
  raw: TRaw
}

/** A route handler function compatible with Halifax's framework-agnostic request/response types. */
export type HttpRouteHandler = (req: HttpRequest, res: HttpResponse) => Promise<void> | void

/** Minimal interface an HTTP server adapter must implement for Halifax to register routes. */
export interface HttpServer {
  /**
   * Register a route handler for the given method and path.
   * @param method - HTTP method (or `'*'` for a catch-all fallback).
   * @param path - Route path pattern (e.g. `'/users/:id'`).
   * @param handler - Async handler function to invoke on matching requests.
   */
  registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void
  /**
   * Start listening on the given port and optional host.
   * @param port - TCP port number to bind to.
   * @param host - Hostname or IP address to bind to (defaults to all interfaces).
   */
  start(port: number, host?: string): Promise<void> | void
}
