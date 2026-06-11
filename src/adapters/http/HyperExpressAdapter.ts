import HyperExpress from 'hyper-express'
import type {
  HttpMethod,
  HttpRequest,
  HttpResponse,
  HttpRouteHandler,
  HttpServer,
  ResourceDefinition
} from '@/core/types.js'
import { registerCrudApi, type CrudApiOptions } from '@/core/crudRouter.js'

/**
 * The minimal slice of a HyperExpress request Halifax reads. HyperExpress exposes an
 * Express-flavoured API on top of uWebSockets, but — unlike Express — the request body
 * is not pre-parsed by middleware; it is downloaded on demand via {@link json}.
 */
interface HyperExpressRequest {
  method: string
  path_parameters: Record<string, string>
  query_parameters: Record<string, string>
  headers: Record<string, string | string[] | undefined>
  json<T = unknown, D = undefined>(default_value?: D): Promise<T | D>
}

/** The minimal slice of a HyperExpress response Halifax writes. */
interface HyperExpressResponse {
  status(code: number): HyperExpressResponse
  json(payload: unknown): unknown
  send(payload?: unknown): unknown
  header(name: string, value: string): unknown
}

/** A HyperExpress route-registration method (e.g. `app.get`). */
type HyperExpressRouteRegistrar = (
  path: string,
  handler: (req: HyperExpressRequest, res: HyperExpressResponse) => unknown
) => unknown

/**
 * The minimal slice of a HyperExpress `Server` or `Router` that Halifax drives.
 *
 * Typing against this structural interface keeps the published `.d.ts` from pinning
 * consumers to a specific `hyper-express` version, mirroring the approach used for Express.
 */
export interface HyperExpressAppLike {
  get: HyperExpressRouteRegistrar
  post: HyperExpressRouteRegistrar
  put: HyperExpressRouteRegistrar
  patch: HyperExpressRouteRegistrar
  delete: HyperExpressRouteRegistrar
  /** Registers a handler for any HTTP method — HyperExpress's catch-all, used for 405 fallbacks. */
  any: HyperExpressRouteRegistrar
  /** Present on a `Server` but not a `Router`; when absent, {@link HyperExpressHttpServer.start} is a no-op. */
  listen?: (port: number, host?: string) => Promise<unknown>
}

/** The HyperExpress route-registration method names (excludes `any`/`listen`). */
type HyperExpressRegistrarMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

/** Maps a Halifax {@link HttpMethod} to the corresponding HyperExpress registration method name. */
const METHOD_TO_REGISTRAR: Record<Exclude<HttpMethod, '*'>, HyperExpressRegistrarMethod> = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete'
}

/** HTTP methods that may carry a request body Halifax needs to parse. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Reads the first value of a (possibly array) header.
 * @param value - The raw header value.
 * @returns The header as a lowercase-safe string, or `''` when absent.
 */
function headerValue(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : ''
}

/**
 * Wraps a HyperExpress request in Halifax's framework-agnostic {@link HttpRequest}.
 *
 * The JSON body is downloaded here (HyperExpress does not pre-parse it). Only requests
 * that both carry a body-bearing method and declare a JSON `Content-Type` are parsed;
 * everything else is left as `undefined`, which lets the CRUD router emit a 415 for
 * non-JSON payloads exactly as the Express adapter (with `express.json()`) does.
 * @param req - The HyperExpress request to adapt.
 * @returns A Halifax-compatible {@link HttpRequest} with the original request in `raw`.
 */
async function adaptRequest(req: HyperExpressRequest): Promise<HttpRequest<HyperExpressRequest>> {
  let body: unknown
  const contentType = headerValue(req.headers['content-type'])
  if (BODY_METHODS.has(req.method.toUpperCase()) && contentType.includes('application/json')) {
    try {
      body = await req.json(undefined)
    } catch {
      body = undefined
    }
  }
  return {
    method: req.method,
    params: req.path_parameters,
    query: req.query_parameters,
    body,
    headers: req.headers,
    raw: req
  }
}

/**
 * Wraps a HyperExpress response in Halifax's framework-agnostic {@link HttpResponse}.
 * @param res - The HyperExpress response to adapt.
 * @returns A Halifax-compatible {@link HttpResponse} with the original response in `raw`.
 */
function adaptResponse(res: HyperExpressResponse): HttpResponse<HyperExpressResponse> {
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
      res.header(name, value)
    }
  }
}

/**
 * Adapts a HyperExpress `Server` or `Router` to Halifax's {@link HttpServer} interface.
 *
 * Like the Express adapter, every route uses plain segments and `:id` named params. The
 * `'*'` catch-all maps to HyperExpress's `any()`, which matches methods not otherwise
 * registered on the path — giving the same 405 behaviour as Express's `app.all`.
 */
export class HyperExpressHttpServer implements HttpServer {
  /**
   * @param app - HyperExpress server or router to register routes on.
   *   When a `Server` is provided, `start()` will call `listen()`.
   *   When a `Router` is provided, `start()` is a no-op.
   */
  public constructor(private readonly app: HyperExpressAppLike) {}

  /**
   * Registers a route on the app for the given method and path.
   * @param method - HTTP method (or `'*'` to register a catch-all via `app.any`).
   * @param path - Route path pattern (e.g. `'/users/:id'`).
   * @param handler - Halifax route handler to invoke on matching requests.
   */
  public registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void {
    const cb = async (req: HyperExpressRequest, res: HyperExpressResponse) => {
      await Promise.resolve(handler(await adaptRequest(req), adaptResponse(res)))
    }
    const register = method === '*' ? this.app.any : this.app[METHOD_TO_REGISTRAR[method]]
    register.call(this.app, path, cb)
  }

  /**
   * Starts the server. No-op when the underlying app does not expose a `listen` method
   * (e.g. when `app` is a `Router` mounted on an existing server).
   * @param port - TCP port number to bind to.
   * @param host - Hostname or IP address to bind to (defaults to all interfaces when omitted).
   */
  public async start(port: number, host?: string): Promise<void> {
    if (typeof this.app.listen !== 'function') return
    await (host ? this.app.listen(port, host) : this.app.listen(port))
  }
}

/** Options for {@link createHyperExpressCrudRouter}. Alias of {@link CrudApiOptions}. */
export type HyperExpressCrudRouterOptions = CrudApiOptions

/**
 * Creates a fully-wired HyperExpress `Router` with CRUD routes for every resource.
 *
 * @param resources - Resource definitions to register (use {@link createPrismaResources} to generate these).
 * @param options - Auth strategy, query-builder path overrides, etc.
 * @returns A HyperExpress `Router` ready to mount with `app.use('/api', router)`.
 */
export function createHyperExpressCrudRouter(
  resources: ResourceDefinition[],
  options: HyperExpressCrudRouterOptions = {}
): InstanceType<typeof HyperExpress.Router> {
  const router = new HyperExpress.Router()
  registerCrudApi(new HyperExpressHttpServer(router as HyperExpressAppLike), resources, options)
  return router
}
