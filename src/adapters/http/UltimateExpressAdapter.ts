import ultimateExpress from 'ultimate-express'
import type {
  HttpMethod,
  HttpRequest,
  HttpResponse,
  HttpRouteHandler,
  HttpServer,
  ResourceDefinition
} from '@/core/types.js'
import { registerCrudApi, type CrudApiOptions } from '@/core/crudRouter.js'

const { Router } = ultimateExpress

/** A route-registration method as exposed by an Ultimate Express app or router (e.g. `app.get`). */
type UltimateExpressRouteRegistrar = (
  path: string,
  handler: (req: UltimateExpressRequest, res: UltimateExpressResponse) => void
) => void

/**
 * The minimal slice of an Ultimate Express request Halifax reads. Ultimate Express is a
 * drop-in, uWebSockets-backed reimplementation of the Express API, so this mirrors the
 * Express request surface exactly.
 */
interface UltimateExpressRequest {
  method: string
  params: Record<string, string>
  query: Record<string, unknown>
  body: unknown
  headers: Record<string, string | string[] | undefined>
}

/** The minimal slice of an Ultimate Express response Halifax writes. */
interface UltimateExpressResponse {
  status(code: number): UltimateExpressResponse
  json(payload: unknown): unknown
  send(payload?: unknown): unknown
  setHeader(name: string, value: string): unknown
}

/**
 * The minimal slice of an Ultimate Express application or router that Halifax drives.
 *
 * Typing against this structural interface — rather than importing concrete types from
 * `ultimate-express` — keeps the published `.d.ts` from pinning consumers to a specific
 * version, exactly as {@link ExpressHttpServer} does for Express.
 */
export interface UltimateExpressAppLike {
  get: UltimateExpressRouteRegistrar
  post: UltimateExpressRouteRegistrar
  put: UltimateExpressRouteRegistrar
  patch: UltimateExpressRouteRegistrar
  delete: UltimateExpressRouteRegistrar
  all: UltimateExpressRouteRegistrar
  /** Present on an `App` but not a `Router`; when absent, {@link UltimateExpressHttpServer.start} is a no-op. */
  listen?: (port: number, host: string | undefined, callback: () => void) => unknown
}

/** The route-registration method names (excludes `listen`). */
type UltimateExpressRegistrarMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'all'

/** Maps a Halifax {@link HttpMethod} to the corresponding Ultimate Express registration method name. */
const METHOD_TO_REGISTRAR: Record<Exclude<HttpMethod, '*'>, UltimateExpressRegistrarMethod> = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete'
}

/**
 * Wraps an Ultimate Express request in Halifax's framework-agnostic {@link HttpRequest}.
 * @param req - The Ultimate Express request to adapt.
 * @returns A Halifax-compatible {@link HttpRequest} with the original request in `raw`.
 */
function adaptRequest(req: UltimateExpressRequest): HttpRequest<UltimateExpressRequest> {
  return {
    method: req.method,
    params: req.params,
    query: req.query,
    body: req.body,
    headers: req.headers,
    raw: req
  }
}

/**
 * Wraps an Ultimate Express response in Halifax's framework-agnostic {@link HttpResponse}.
 * @param res - The Ultimate Express response to adapt.
 * @returns A Halifax-compatible {@link HttpResponse} with the original response in `raw`.
 */
function adaptResponse(res: UltimateExpressResponse): HttpResponse<UltimateExpressResponse> {
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

/**
 * Adapts an Ultimate Express `App` or `Router` to Halifax's {@link HttpServer} interface.
 *
 * Because Ultimate Express implements the Express API, this adapter is a near-identical
 * twin of {@link ExpressHttpServer}: it uses the same route methods, `:id` named params
 * (never `*` path wildcards), and request/response surface. The difference is purely the
 * underlying transport (uWebSockets), which is faster but otherwise transparent.
 */
export class UltimateExpressHttpServer implements HttpServer {
  /**
   * @param app - Ultimate Express application or router to register routes on.
   *   When an `App` is provided, `start()` will call `listen()`.
   *   When a `Router` is provided, `start()` is a no-op.
   */
  public constructor(private readonly app: UltimateExpressAppLike) {}

  /**
   * Registers a route on the app for the given method and path.
   * @param method - HTTP method (or `'*'` to register a catch-all via `app.all`).
   * @param path - Route path pattern (e.g. `'/users/:id'`).
   * @param handler - Halifax route handler to invoke on matching requests.
   */
  public registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void {
    const cb = (req: UltimateExpressRequest, res: UltimateExpressResponse) => {
      void Promise.resolve(handler(adaptRequest(req), adaptResponse(res)))
    }
    const register = method === '*' ? this.app.all : this.app[METHOD_TO_REGISTRAR[method]]
    register.call(this.app, path, cb)
  }

  /**
   * Starts the server. No-op when the underlying app does not expose a `listen` method
   * (e.g. when `app` is a `Router` mounted on an existing app).
   * @param port - TCP port number to bind to.
   * @param host - Hostname or IP address to bind to (defaults to all interfaces when omitted).
   */
  public async start(port: number, host?: string): Promise<void> {
    await new Promise<void>((resolve) => {
      if (typeof this.app.listen === 'function') {
        this.app.listen(port, host, () => resolve())
        return
      }
      resolve()
    })
  }
}

/** Options for {@link createUltimateExpressCrudRouter}. Alias of {@link CrudApiOptions}. */
export type UltimateExpressCrudRouterOptions = CrudApiOptions

/**
 * Creates a fully-wired Ultimate Express `Router` with CRUD routes for every resource.
 *
 * @param resources - Resource definitions to register (use {@link createPrismaResources} to generate these).
 * @param options - Auth strategy, query-builder path overrides, etc.
 * @returns An Ultimate Express `Router` ready to mount with `app.use('/api', router)`.
 */
export function createUltimateExpressCrudRouter(
  resources: ResourceDefinition[],
  options: UltimateExpressCrudRouterOptions = {}
): ReturnType<typeof Router> {
  const router = Router()
  registerCrudApi(
    new UltimateExpressHttpServer(router as UltimateExpressAppLike),
    resources,
    options
  )
  return router
}
