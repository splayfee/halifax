import type { AuthStrategy } from '@/auth/AuthStrategy.js'
import type { HttpServer } from '@/core/types.js'
import type { OpenApiSpec } from '@/openapi/types.js'
import {
  registerCustomEndpoint,
  resolveCustomEndpoint,
  type CustomEndpointDeps,
  type CustomEndpointHandler,
  type CustomEndpointMethod,
  type CustomEndpointOpenApi,
  type CustomEndpointOptions
} from '@/core/customEndpoint.js'

/**
 * The object returned by {@link registerCrudApi}. Holds references to the live server and spec so
 * custom endpoints can be registered after the initial CRUD wiring — at startup or lazily from
 * another module — each inheriting Halifax's content negotiation, auth, error handling, and
 * (optionally) live OpenAPI documentation.
 *
 * @example
 * ```ts
 * const api = registerCrudApi(server, resources, options)
 *
 * api.addCustomEndpoint(
 *   'GET',
 *   '/reports/sales-summary',
 *   ['analyst'],
 *   async (req, res, ctx) => {
 *     const data = await buildReport(ctx.auth)
 *     await res.status(200).json(data)
 *   },
 *   { summary: 'Sales summary report', tags: ['Reports'] }
 * )
 * ```
 */
export class HalifaxApi {
  private readonly deps: CustomEndpointDeps

  /**
   * @internal — constructed exclusively by {@link registerCrudApi}.
   */
  constructor(
    server: HttpServer,
    authStrategy: AuthStrategy,
    registeredRoutes: Set<string>,
    liveSpec: OpenApiSpec | null
  ) {
    this.deps = { server, authStrategy, registeredRoutes, liveSpec }
  }

  /**
   * Registers a custom route that participates in Halifax's content negotiation, auth pipeline,
   * error handling, and (optionally) OpenAPI documentation.
   *
   * Two call forms are supported:
   * - **Positional** — `(method, path, roles, handler, openapi?)`. `roles: []` allows any
   *   authenticated caller; `roles: null` makes the endpoint **public** (auth is skipped).
   * - **Options bag** — `(method, path, options, handler)` where {@link CustomEndpointOptions}
   *   unlocks `consumes`/`produces` (file uploads, binary responses), a per-endpoint `authorize`
   *   predicate, and `auth: false` for public routes.
   *
   * @returns `this` for chaining.
   * @throws {@link ServerError} when `method + path` is already registered.
   */
  addCustomEndpoint(
    method: CustomEndpointMethod,
    path: string,
    roles: string[] | null,
    handler: CustomEndpointHandler,
    openapi?: CustomEndpointOpenApi
  ): this
  addCustomEndpoint(
    method: CustomEndpointMethod,
    path: string,
    options: CustomEndpointOptions,
    handler: CustomEndpointHandler
  ): this
  addCustomEndpoint(
    method: CustomEndpointMethod,
    path: string,
    rolesOrOptions: string[] | null | CustomEndpointOptions,
    handler: CustomEndpointHandler,
    openapi?: CustomEndpointOpenApi
  ): this {
    const endpoint = resolveCustomEndpoint(rolesOrOptions, openapi)
    registerCustomEndpoint(this.deps, method, path, endpoint, handler)
    return this
  }
}
