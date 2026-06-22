import type { GraphQLFieldConfigMap } from 'graphql'
import type { GqlModule, GraphQLResourceContext, GraphQLResolverContext } from './types.js'
import type { SchemaHelpers } from './schemaHelpers.js'
import { defaultCrudPermissions } from '@/core/types.js'
import { toPascalCase } from '@/core/stringUtils.js'
import {
  buildResourceTypes,
  partitionFields,
  type ResolverContext
} from './resolvers/resourceTypes.js'
import { addQueryResolvers } from './resolvers/queryResolvers.js'
import { addMutationResolvers } from './resolvers/mutationResolvers.js'

/**
 * Adds all query and mutation fields for a single resource to the provided field maps. Called once
 * per resource inside `buildGraphQLSchema`. The work is delegated to focused modules: this function
 * resolves permissions and field sets, builds the resource's GraphQL types via
 * {@link buildResourceTypes}, then registers its read and write resolvers via
 * {@link addQueryResolvers} / {@link addMutationResolvers}.
 */
export function addResourceFields(
  gql: GqlModule,
  helpers: SchemaHelpers,
  ctx: GraphQLResourceContext,
  queryFields: GraphQLFieldConfigMap<unknown, GraphQLResolverContext>,
  mutationFields: GraphQLFieldConfigMap<unknown, GraphQLResolverContext>
): void {
  const { resource } = ctx
  if (resource.graphql === false) return

  const permissions = { ...defaultCrudPermissions, ...resource.permissions }
  const typeName = toPascalCase(resource.routePrefix)
  const fieldSets = partitionFields(resource)
  const types = buildResourceTypes(gql, helpers, resource, typeName, fieldSets)

  const rc: ResolverContext = { ...ctx, gql, helpers, typeName, types, fieldSets }
  addQueryResolvers(rc, permissions, queryFields)
  addMutationResolvers(rc, permissions, mutationFields)
}
