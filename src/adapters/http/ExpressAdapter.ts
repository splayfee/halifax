import type { Express, Request, Response } from 'express'
import { Router } from 'express'
import type {
  HttpMethod,
  HttpRequest,
  HttpResponse,
  HttpRouteHandler,
  HttpServer
} from '@/core/http.js'
import { registerCrudApi, type CrudApiOptions } from '@/core/crudRouter.js'
import type { ResourceDefinition } from '@/core/types.js'

/**
 * Casts Express's header map to Halifax's `Record<string, string | string[] | undefined>` type.
 * Express guarantees header names are lowercase and values are strings or string arrays,
 * so this cast is safe.
 * @param headers - The raw headers object from an Express `Request`.
 * @returns The same object typed as Halifax's header record.
 */
function normalizeHeaders(
  headers: Request['headers']
): Record<string, string | string[] | undefined> {
  return headers as Record<string, string | string[] | undefined>
}

/**
 * Wraps an Express `Request` in Halifax's framework-agnostic {@link HttpRequest}.
 * @param req - The Express request to adapt.
 * @returns A Halifax-compatible {@link HttpRequest} with the original request in `raw`.
 */
function adaptRequest(req: Request): HttpRequest<Request> {
  return {
    method: req.method,
    params: req.params as Record<string, string>,
    query: req.query as Record<string, unknown>,
    body: req.body,
    headers: normalizeHeaders(req.headers),
    raw: req
  }
}

/**
 * Wraps an Express `Response` in Halifax's framework-agnostic {@link HttpResponse}.
 * @param res - The Express response to adapt.
 * @returns A Halifax-compatible {@link HttpResponse} with the original response in `raw`.
 */
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
    },
    setHeader(name: string, value: string) {
      res.setHeader(name, value)
    }
  }
}

/** Adapts an Express `App` or `Router` to Halifax's {@link HttpServer} interface. */
export class ExpressHttpServer implements HttpServer {
  /**
   * @param app - Express application or router to register routes on.
   *   When an `App` is provided, `start()` will call `listen()`.
   *   When a `Router` is provided, `start()` is a no-op.
   */
  public constructor(private readonly app: Express | Router) {}

  /**
   * Registers a route on the Express app for the given method and path.
   * @param method - HTTP method (or `'*'` to register a catch-all via `app.all`).
   * @param path - Route path pattern (e.g. `'/users/:id'`).
   * @param handler - Halifax route handler to invoke on matching requests.
   */
  public registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void {
    const cb = (req: Request, res: Response) => {
      void Promise.resolve(handler(adaptRequest(req), adaptResponse(res)))
    }
    if (method === '*') {
      ;(this.app as any).all(path, cb)
      return
    }
    ;(this.app as any)[method.toLowerCase()](path, cb)
  }

  /**
   * Starts the Express server. No-op when the underlying app does not expose a `listen` method
   * (e.g. when `app` is a `Router` mounted on an existing Express app).
   * @param port - TCP port number to bind to.
   * @param host - Hostname or IP address to bind to (defaults to all interfaces when omitted).
   */
  public async start(port: number, host?: string): Promise<void> {
    await new Promise<void>((resolve) => {
      if ('listen' in this.app && typeof this.app.listen === 'function') {
        ;(this.app as any).listen(port, host, () => resolve())
        return
      }
      resolve()
    })
  }
}

/** Options for {@link createExpressCrudRouter}. Alias of {@link CrudApiOptions}. */
export type ExpressCrudRouterOptions = CrudApiOptions

/**
 * Creates a fully-wired Express `Router` with CRUD routes for every resource.
 *
 * @param resources - Resource definitions to register (use {@link createPrismaResources} to generate these).
 * @param options - Auth strategy, query-builder path overrides, etc.
 * @returns An Express `Router` ready to mount with `app.use('/api', router)`.
 */
export function createExpressCrudRouter(
  resources: ResourceDefinition[],
  options: ExpressCrudRouterOptions = {}
): Router {
  const router = Router()
  registerCrudApi(new ExpressHttpServer(router), resources, options)
  return router
}
