export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface HttpRequest<TRaw = unknown> {
  params: Record<string, string>
  query: Record<string, unknown>
  body: unknown
  headers: Record<string, string | string[] | undefined>
  raw: TRaw
}

export interface HttpResponse<TRaw = unknown> {
  status(code: number): HttpResponse<TRaw>
  json(payload: unknown): void | Promise<void>
  send?(payload?: unknown): void | Promise<void>
  setHeader?(name: string, value: string): void
  raw: TRaw
}

export type HttpRouteHandler = (req: HttpRequest, res: HttpResponse) => Promise<void> | void

export interface HttpServer {
  registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void
  start(port: number, host?: string): Promise<void> | void
}
