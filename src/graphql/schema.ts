import type { GraphQLSchema, GraphQLFieldConfigMap } from 'graphql'
import type { GraphQLResourceContext, GraphQLResolverContext } from './types.js'
import { buildSchemaHelpers } from './schemaHelpers.js'
import { addResourceFields } from './resourceResolvers.js'

export async function buildGraphQLSchema(contexts: GraphQLResourceContext[]): Promise<GraphQLSchema> {
  const gql = await import('graphql')
  const {
    GraphQLSchema,
    GraphQLObjectType,
    GraphQLString
  } = gql

  const helpers = buildSchemaHelpers(gql)

  const queryFields: GraphQLFieldConfigMap<unknown, GraphQLResolverContext> = {}
  const mutationFields: GraphQLFieldConfigMap<unknown, GraphQLResolverContext> = {}

  for (const ctx of contexts) {
    addResourceFields(gql, helpers, ctx, queryFields, mutationFields)
  }

  // GraphQL schema must have a Query root type — add a placeholder when no resources are enabled.
  if (!Object.keys(queryFields).length) {
    queryFields['_empty'] = {
      type: GraphQLString,
      description: 'Placeholder — no resources are GraphQL-enabled.',
      resolve: () => 'No GraphQL-enabled resources are registered.'
    }
  }

  const hasMutations = Object.keys(mutationFields).length > 0

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: queryFields }),
    ...(hasMutations
      ? { mutation: new GraphQLObjectType({ name: 'Mutation', fields: mutationFields }) }
      : {})
  })
}
