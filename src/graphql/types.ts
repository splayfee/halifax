import type { AuthContext } from '@/auth/AuthStrategy.js'
import type { AuthStrategy } from '@/auth/strategies/types.js'
import type { CrudHooks } from '@/core/hooks.js'
import type { CrudAction, HttpRequest, Repository, ResourceDefinition } from '@/core/types.js'

/** The lazily-imported `graphql` module — the optional peer dependency, loaded only when enabled. */
export type GqlModule = typeof import('graphql')

/** Configuration for the Halifax GraphQL endpoint. */
export interface GraphQLOptions {
  /**
   * Must be explicitly set to `true` to enable the GraphQL endpoint.
   * GraphQL is **disabled by default** — the peer dependency (`graphql`) is optional
   * and will not be imported until you opt in.
   */
  enabled?: boolean
  /**
   * Path for the `POST /graphql` endpoint.
   * Defaults to `'/graphql'`.
   */
  path?: string
  /**
   * When `true`, serve GraphiQL IDE at `GET <path>`.
   * Defaults to `true`.
   */
  graphiql?: boolean
  /**
   * When `true`, the GraphQL endpoint requires authentication before executing any operation,
   * including introspection. Unauthenticated callers receive 401.
   * Defaults to `false`.
   */
  requireAuth?: boolean
  /** Title shown in the GraphiQL browser tab. Defaults to `'Halifax GraphQL'`. */
  title?: string
}

/** Internal per-resource context threaded into the schema builder and resolvers. */
export interface GraphQLResourceContext {
  resource: ResourceDefinition
  authStrategy: AuthStrategy
  hooks:
    | CrudHooks<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>
    | undefined
  resolveRepo: (req: HttpRequest, auth: AuthContext, action: CrudAction) => Promise<Repository>
}

/** GraphQL resolver context — the `contextValue` passed to every field resolver. */
export interface GraphQLResolverContext {
  req: HttpRequest
}

/** Standard GraphQL-over-HTTP request body. */
export interface GraphQLRequestBody {
  query?: string
  variables?: Record<string, unknown>
  operationName?: string
}
