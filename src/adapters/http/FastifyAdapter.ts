import type {
  HttpMethod,
  HttpRequest,
  HttpResponse,
  HttpRouteHandler,
  HttpServer,
  ResourceDefinition
} from '@/core/types.js'
import { registerCrudApi, type CrudApiOptions } from '@/core/crudRouter.js'

/** The minimal slice of a Fastify request Halifax reads. Fastify pre-parses the JSON body. */
interface FastifyRequestLike {
  method: string
  params: unknown
  query: unknown
  body: unknown
  headers: Record<string, string | string[] | undefined>
}

/** The minimal slice of a Fastify reply Halifax writes. */
interface FastifyReplyLike {
  code(statusCode: number): FastifyReplyLike
  send(payload?: unknown): unknown
  header(name: string, value: string): unknown
}

/** A Fastify route handler bound to the structural request/reply shapes above. */
type FastifyHandlerLike = (req: FastifyRequestLike, reply: FastifyReplyLike) => unknown

/**
 * The minimal slice of a Fastify instance that Halifax drives.
 *
 * Typing against this structural interface keeps the published `.d.ts` from pinning
 * consumers to a specific `fastify` version, mirroring the approach used for Express.
 */
export interface FastifyAppLike {
  route(opts: { method: string | string[]; url: string; handler: FastifyHandlerLike }): unknown
  addContentTypeParser(
    contentType: string | RegExp | string[],
    opts: { parseAs: 'string' | 'buffer' },
    parser: (
      req: unknown,
      body: string | Buffer,
      done: (err: Error | null, body?: unknown) => void
    ) => void
  ): unknown
  listen(opts: { port: number; host?: string }): Promise<unknown>
}

/**
 * The CRUD HTTP verbs Halifax registers. Used to compute the complement set for the
 * `'*'` catch-all so unsupported methods produce a 405 (as Express's `app.all` does)
 * rather than Fastify's default 404. `HEAD` is intentionally excluded because Fastify
 * auto-exposes a `HEAD` route for every `GET`; including it would collide.
 */
const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

/**
 * Wraps a Fastify request in Halifax's framework-agnostic {@link HttpRequest}.
 * @param req - The Fastify request to adapt.
 * @returns A Halifax-compatible {@link HttpRequest} with the original request in `raw`.
 */
function adaptRequest(req: FastifyRequestLike): HttpRequest<FastifyRequestLike> {
  return {
    method: req.method,
    params: (req.params ?? {}) as Record<string, string>,
    query: (req.query ?? {}) as Record<string, unknown>,
    body: req.body,
    headers: req.headers,
    raw: req
  }
}

/**
 * Wraps a Fastify reply in Halifax's framework-agnostic {@link HttpResponse}.
 * @param reply - The Fastify reply to adapt.
 * @returns A Halifax-compatible {@link HttpResponse} with the original reply in `raw`.
 */
function adaptResponse(reply: FastifyReplyLike): HttpResponse<FastifyReplyLike> {
  return {
    raw: reply,
    status(code: number) {
      reply.code(code)
      return this
    },
    json(payload: unknown) {
      reply.send(payload)
    },
    send(payload?: unknown) {
      reply.send(payload)
    },
    setHeader(name: string, value: string) {
      reply.header(name, value)
    }
  }
}

/**
 * Adapts a Fastify instance to Halifax's {@link HttpServer} interface.
 *
 * Two Fastify-specific concerns are handled here so the resulting API behaves like the
 * Express adapter:
 *
 * - **415 parity.** A catch-all content-type parser is installed so non-JSON bodies are
 *   accepted (as raw strings) and reach the router, which then emits the structured 415
 *   — instead of Fastify's own non-Halifax 415 error page.
 * - **405 parity.** The `'*'` catch-all is registered for every CRUD verb *not* already
 *   bound on the path, so unsupported methods return 405 (with the `Allow` header the
 *   router sets) rather than Fastify's default 404.
 */
export class FastifyHttpServer implements HttpServer {
  /** Tracks which HTTP methods have been bound per URL, to compute the `'*'` complement. */
  private readonly registered = new Map<string, Set<string>>()

  /**
   * @param app - The Fastify instance (or encapsulated plugin instance) to register routes on.
   */
  public constructor(private readonly app: FastifyAppLike) {
    // Accept any Content-Type so the router — not Fastify — owns the 415 decision. The
    // built-in `application/json` parser still takes precedence for JSON bodies.
    try {
      this.app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) =>
        done(null, body)
      )
    } catch {
      // A parser for '*' is already registered on this instance — nothing to do.
    }
  }

  /**
   * Registers a route on the Fastify instance for the given method and path.
   * @param method - HTTP method (or `'*'` for a catch-all spanning every unbound CRUD verb).
   * @param path - Route path pattern (e.g. `'/users/:id'`).
   * @param handler - Halifax route handler to invoke on matching requests.
   */
  public registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void {
    const run: FastifyHandlerLike = (req, reply) =>
      Promise.resolve(handler(adaptRequest(req), adaptResponse(reply)))

    if (method === '*') {
      const bound = this.registered.get(path) ?? new Set<string>()
      const complement = ALL_METHODS.filter((m) => !bound.has(m))
      if (complement.length)
        this.app.route({ method: complement as string[], url: path, handler: run })
      return
    }

    const bound = this.registered.get(path) ?? new Set<string>()
    bound.add(method)
    this.registered.set(path, bound)
    this.app.route({ method, url: path, handler: run })
  }

  /**
   * Starts the Fastify server listening on the given port and host.
   * @param port - TCP port number to bind to.
   * @param host - Hostname or IP address to bind to (defaults to all interfaces when omitted).
   */
  public async start(port: number, host?: string): Promise<void> {
    await this.app.listen(host ? { port, host } : { port })
  }
}

/** Options for {@link createFastifyCrudPlugin}. Alias of {@link CrudApiOptions}. */
export type FastifyCrudPluginOptions = CrudApiOptions

/** A Fastify plugin function: registered with `app.register(plugin, { prefix: '/api' })`. */
export type FastifyCrudPlugin = (instance: FastifyAppLike) => Promise<void>

/**
 * Creates a Fastify plugin that registers CRUD routes for every resource.
 *
 * Fastify's mounting mechanism is plugins-with-prefixes rather than mountable routers, so
 * this is the idiomatic equivalent of {@link createExpressCrudRouter}:
 *
 * ```ts
 * app.register(createFastifyCrudPlugin([postResource], { authStrategy }), { prefix: '/api/v1' })
 * ```
 *
 * @param resources - Resource definitions to register (use {@link createPrismaResources} to generate these).
 * @param options - Auth strategy, query-builder path overrides, etc.
 * @returns A Fastify plugin function ready to pass to `app.register`.
 */
export function createFastifyCrudPlugin(
  resources: ResourceDefinition[],
  options: FastifyCrudPluginOptions = {}
): FastifyCrudPlugin {
  return async function halifaxCrudPlugin(instance: FastifyAppLike): Promise<void> {
    registerCrudApi(new FastifyHttpServer(instance), resources, options)
  }
}
