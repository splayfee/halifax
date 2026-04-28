import { HttpMethod, HttpRequest, HttpResponse, HttpRouteHandler, HttpServer } from '../../core/http.js'

type HyperExpressLike = Record<string, any> & {
  listen(port: number, host?: string): Promise<unknown> | unknown
}

async function getBody(request: any): Promise<unknown> {
  if (request.body !== undefined) return request.body
  if (typeof request.json === 'function') return await request.json()
  if (typeof request.body === 'function') return await request.body()
  return undefined
}

function getQuery(request: any): Record<string, unknown> {
  if (request.query_parameters) return request.query_parameters
  if (request.query) return typeof request.query === 'function' ? request.query() : request.query
  return {}
}

function getParams(request: any): Record<string, string> {
  return request.path_parameters ?? request.params ?? request.parameters ?? {}
}

function getHeaders(request: any): Record<string, string | string[] | undefined> {
  if (request.headers) return typeof request.headers === 'function' ? request.headers() : request.headers
  return {}
}

async function adaptRequest(request: any): Promise<HttpRequest> {
  return {
    params: getParams(request),
    query: getQuery(request),
    body: await getBody(request),
    headers: getHeaders(request),
    raw: request
  }
}

function adaptResponse(response: any): HttpResponse {
  return {
    raw: response,
    status(code: number) {
      if (typeof response.status === 'function') response.status(code)
      else if (typeof response.statusCode === 'function') response.statusCode(code)
      else response.statusCode = code
      return this
    },
    json(payload: unknown) {
      if (typeof response.json === 'function') return response.json(payload)
      if (typeof response.send === 'function') return response.send(JSON.stringify(payload))
      return undefined
    },
    send(payload?: unknown) {
      if (typeof response.send === 'function') return response.send(payload)
      return undefined
    }
  }
}

export class HyperExpressHttpServer implements HttpServer {
  public constructor(private readonly app: HyperExpressLike) {}

  public registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void {
    const routeMethod = method.toLowerCase()
    if (typeof this.app[routeMethod] !== 'function') {
      throw new Error(`Hyper Express app does not expose ${routeMethod}().`)
    }
    this.app[routeMethod](path, async (request: any, response: any) => {
      await handler(await adaptRequest(request), adaptResponse(response))
    })
  }

  public async start(port: number, host?: string): Promise<void> {
    await this.app.listen(port, host)
  }
}
