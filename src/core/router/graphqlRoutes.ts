import type { AuthStrategy } from '@/auth/AuthStrategy.js'
import type { CrudHooks } from '@/core/hooks.js'
import type { ResourceDefinition } from '@/core/types.js'
import { registerGraphqlRoute } from '@/graphql/index.js'
import type { ResolveRepo } from './tenantScope.js'
import type { CrudApiOptions } from './options.js'
import type { TrackingHttpServer } from './trackingHttpServer.js'

/** Per-resource context shared between REST registration and the GraphQL schema builder. */
export interface GqlCtx {
  resource: ResourceDefinition
  hooks: CrudHooks<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> | undefined
  resolveRepo: ResolveRepo
}

/**
 * Registers the GraphQL endpoint (execution + optional GraphiQL) when `options.graphql.enabled`
 * is `true`. The schema is generated from the same per-resource contexts used for REST, so REST
 * and GraphQL stay in lockstep. No-op when GraphQL is disabled.
 */
export function setupGraphql(
  tracker: TrackingHttpServer,
  gqlContexts: GqlCtx[],
  options: CrudApiOptions,
  authStrategy: AuthStrategy
): void {
  if (options.graphql?.enabled !== true) return
  registerGraphqlRoute(
    tracker,
    gqlContexts.map(({ resource, hooks, resolveRepo }) => ({
      resource,
      authStrategy,
      hooks,
      resolveRepo
    })),
    options.graphql,
    authStrategy
  )
}
