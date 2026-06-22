import type { AuthContext, AuthStrategy } from '@/auth/AuthStrategy.js'
import type { CacheStore } from '@/core/cache/index.js'
import type { OpenApiOptions } from '@/openapi/index.js'
import type { GraphQLOptions } from '@/graphql/index.js'
import type { HttpRequest, ResourceDefinition } from '@/core/types.js'

/** Context handed to {@link TenantOptions.resolveId} for the current request. */
export interface TenantResolveContext {
  /** The resolved authentication context for the request. */
  auth: AuthContext
  /** The incoming HTTP request. */
  req: HttpRequest
  /** The resource being accessed. */
  resource: ResourceDefinition
}

/**
 * Configures multi-tenant isolation for the whole API. When set, every resource that
 * is tenant-scoped (see {@link ResourceDefinition.tenant}) has all of its reads, writes,
 * and bulk operations confined to the tenant value returned by {@link TenantOptions.resolveId}.
 */
export interface TenantOptions {
  /**
   * Resolve the tenant key the current caller is bound to (e.g. their company id),
   * derived from the authenticated session/token — never from client-supplied input.
   * Return `null`/`undefined` to signal "no tenant"; combined with {@link TenantOptions.strict}
   * this either denies the request (default) or serves it unscoped.
   */
  resolveId: (ctx: TenantResolveContext) => unknown | Promise<unknown>
  /**
   * Default tenant column name used to auto-detect scoping: any resource that has a
   * field with this name (and no explicit {@link ResourceDefinition.tenant}) is scoped
   * on it. Defaults to `'tenantId'`.
   */
  field?: string
  /**
   * Fail-closed switch. When `true` (the default), a tenant-scoped resource whose
   * {@link TenantOptions.resolveId} returns no value rejects the request with 403 rather
   * than serving unscoped data. Only set to `false` if you deliberately allow
   * cross-tenant ("god mode") access for callers with no tenant.
   */
  strict?: boolean
  /**
   * Roles or permission slugs whose holders may bypass tenant scoping for **read** operations
   * (`getOne`, `getMany`, and the query builder), allowing them to see records across all tenants.
   * Any single match in `auth.roles` or `auth.permissions` grants the bypass.
   *
   * When a bypass caller wants to see only one tenant's data they use the normal filter
   * mechanism — `?companyId=42` on REST or `filter: { companyId: 42 }` in GraphQL.
   * No special header or query parameter is needed; the tenant field is just another filterable
   * column from the admin's perspective.
   *
   * Write operations (create / update / delete) are **never** bypassed: the tenant value
   * continues to come from `resolveId`, keeping write provenance tied to auth — never to
   * client-supplied input. An admin whose token carries no tenant will receive 403 on writes
   * unless `strict` is `false`.
   *
   * Per-resource {@link ResourceDefinition.bypassTenantRoles} takes precedence over this list.
   *
   * @example
   * ```ts
   * bypassRoles: ['super_admin', 'support:read-all']
   * ```
   */
  bypassRoles?: string[]
}

/** Options for {@link registerCrudApi} / {@link createExpressCrudRouter}. */
export interface CrudApiOptions {
  /** Auth strategy used for all routes. Defaults to {@link AllowAllAuthStrategy}. */
  authStrategy?: AuthStrategy
  /** Multi-tenant isolation config. When omitted, no tenant scoping is applied. */
  tenant?: TenantOptions
  /** Path segment for the query-builder POST route (default: `'query'`). */
  queryBuilderPath?: string
  /**
   * Wrap every success response body under a single key (e.g. `'data'` → `{ "data": <body> }`)
   * for all resources. Per-resource {@link ResourceDefinition.envelope} takes precedence.
   * Error responses are never enveloped.
   */
  envelope?: string | null
  /**
   * Enable OpenAPI 3.1 spec generation and interactive docs. When set, Halifax registers two
   * additional routes: `GET /openapi.json` (raw spec) and `GET /docs` (Swagger UI).
   */
  openapi?: OpenApiOptions
  /**
   * Enable a GraphQL endpoint. GraphQL is **disabled by default** — you must set
   * `enabled: true` to activate it. When enabled, Halifax registers `POST <path>` (execution)
   * and optionally `GET <path>` (GraphiQL IDE). The schema is auto-generated from all
   * resources that have `graphql !== false`. Requires the `graphql` peer dependency.
   *
   * See [README_GRAPHQL.md](./README_GRAPHQL.md) for full docs and examples.
   *
   * @example
   * ```ts
   * graphql: { enabled: true, path: '/graphql', graphiql: true }
   * ```
   */
  graphql?: GraphQLOptions
  /**
   * API-wide read-through caching. Provide a `store` (defaults to an in-process
   * {@link InMemoryCacheStore}) and/or a default `ttlSeconds` applied to every resource that
   * doesn't set its own {@link ResourceDefinition.cache}. Per-resource config takes precedence.
   */
  cache?: {
    /** Backing cache store shared by all resources. Defaults to an in-process store. */
    store?: CacheStore
    /**
     * Default TTL (seconds) applied to all resources lacking their own cache config.
     * `0` means never expire; omit to leave caching off by default.
     */
    ttlSeconds?: number
    /**
     * Request header that force-refreshes the cache for that request. Defaults to
     * `'Cache-Control'` (busts when the value contains `no-cache`/`no-store`). Set a custom
     * header name to bust whenever that header is present with any value.
     */
    bustHeader?: string
  }
}
