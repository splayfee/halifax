import type { Express, Request, Response } from 'express'
import { Router } from 'express'
import { HttpMethod, HttpRequest, HttpResponse, HttpRouteHandler, HttpServer } from '../../core/http.js'
import { registerCrudApi, CrudApiOptions } from '../../core/crudRouter.js'
import { ResourceDefinition } from '../../core/types.js'

function normalizeHeaders(headers: Request['headers']): Record<string, string | string[] | undefined> {
  return headers as Record<string, string | string[] | undefined>
}

function adaptRequest(req: Request): HttpRequest<Request> {
  return {
    params: req.params as Record<string, string>,
    query: req.query as Record<string, unknown>,
    body: req.body,
    headers: normalizeHeaders(req.headers),
    raw: req
  }
}

function adaptResponse(res: Response): HttpResponse<Response> {
  return {
    raw: res,
    status(code: number) {
      res.status(code)
      return this
    },
    json(payload: unknown) {
      res.json(payload)
    },
    send(payload?: unknown) {
      res.send(payload)
    }
  }
}

export class ExpressHttpServer implements HttpServer {
  public constructor(private readonly app: Express | Router) {}

  public registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void {
    const lower = method.toLowerCase() as Lowercase<HttpMethod>
    (this.app as any)[lower](path, (req: Request, res: Response) => {
      void Promise.resolve(handler(adaptRequest(req), adaptResponse(res)))
    })
  }

  public async start(port: number, host?: string): Promise<void> {
    await new Promise<void>((resolve) => {
      if ('listen' in this.app && typeof this.app.listen === 'function') {
        (this.app as any).listen(port, host, () => resolve())
        return
      }
      resolve()
    })
  }
}

export interface ExpressCrudRouterOptions extends CrudApiOptions {}

export function createExpressCrudRouter(resources: ResourceDefinition[], options: ExpressCrudRouterOptions = {}): Router {
  const router = Router()
  registerCrudApi(new ExpressHttpServer(router), resources, options)
  return router
}
