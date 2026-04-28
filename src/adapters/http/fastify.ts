import { HttpMethod, HttpRequest, HttpResponse, HttpRouteHandler, HttpServer } from '../../core/http.js'

type FastifyLike = {
  route(options: { method: string; url: string; handler: (request: any, reply: any) => unknown }): unknown
  listen(options: { port: number; host?: string }): Promise<unknown>
}

function adaptRequest(request: any): HttpRequest {
  return {
    params: request.params ?? {},
    query: request.query ?? {},
    body: request.body,
    headers: request.headers ?? {},
    raw: request
  }
}

function adaptResponse(reply: any): HttpResponse {
  return {
    raw: reply,
    status(code: number) {
      reply.code(code)
      return this
    },
    json(payload: unknown) {
      return reply.send(payload)
    },
    send(payload?: unknown) {
      return reply.send(payload)
    }
  }
}

export class FastifyHttpServer implements HttpServer {
  public constructor(private readonly app: FastifyLike) {}

  public registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void {
    this.app.route({
      method,
      url: path,
      handler: async (request, reply) => {
        await handler(adaptRequest(request), adaptResponse(reply))
      }
    })
  }

  public async start(port: number, host?: string): Promise<void> {
    await this.app.listen({ port, host })
  }
}
