import type { HttpMethod, HttpRouteHandler, HttpServer } from '@/core/types.js'

/**
 * GoF **Decorator**: wraps an {@link HttpServer}, implementing the same interface while adding one
 * behaviour — recording every registered route key (`METHOD:path`) in a shared `Set` so
 * {@link HalifaxApi.addCustomEndpoint} can detect collisions with generated CRUD routes. Wildcard
 * catch-all fallbacks (the 405 handlers) are not real endpoints and are excluded from the set.
 *
 * (Named for its role rather than `*Decorator` — the canonical, public-facing Decorator in the
 * codebase is {@link createCachingRepository} in `CachingRepositoryDecorator.ts`; this is a small
 * internal wrapper.)
 */
export class TrackingHttpServer implements HttpServer {
  constructor(
    private readonly inner: HttpServer,
    private readonly routes: Set<string>
  ) {}

  registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void {
    if (method !== '*') this.routes.add(`${method}:${path}`)
    this.inner.registerRoute(method, path, handler)
  }

  start(port: number, host?: string): Promise<void> | void {
    return this.inner.start(port, host)
  }
}
