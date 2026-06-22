import type {
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLFieldConfigMap,
  GraphQLInputFieldConfigMap
} from 'graphql'
import type { FieldDefinition, ResourceDefinition } from '@/core/types.js'
import type { GqlModule, GraphQLResourceContext, GraphQLResolverContext } from '../types.js'
import type { SchemaHelpers } from '../schemaHelpers.js'

/** The set of GraphQL types generated for one resource, shared by its query and mutation resolvers. */
export interface ResourceGqlTypes {
  OutputType: GraphQLObjectType
  ListResultType: GraphQLObjectType
  CreateInputType: GraphQLInputObjectType
  UpdateInputType: GraphQLInputObjectType
  FilterInputType: GraphQLInputObjectType
  UpdateManyResultType: GraphQLObjectType
  DeleteManyResultType: GraphQLObjectType
}

/** The resource's fields partitioned by the access flag each resolver group cares about. */
export interface ResourceFieldSets {
  idField: string
  selectableFields: FieldDefinition[]
  writableFields: FieldDefinition[]
  filterableFields: FieldDefinition[]
}

/** Everything a query/mutation resolver group needs: the resource context, helpers, and built types. */
export interface ResolverContext extends GraphQLResourceContext {
  gql: GqlModule
  helpers: SchemaHelpers
  typeName: string
  types: ResourceGqlTypes
  fieldSets: ResourceFieldSets
}

/** Splits a resource's fields into the selectable / writable / filterable sets used to build types. */
export function partitionFields(resource: ResourceDefinition): ResourceFieldSets {
  const idField = resource.repository?.idField ?? 'id'
  const allFields = resource.fields ?? []
  return {
    idField,
    selectableFields: allFields.filter((f) => f.selectable !== false),
    writableFields: allFields.filter((f) => f.name !== idField && f.writable !== false),
    filterableFields: allFields.filter((f) => f.filterable !== false)
  }
}

/**
 * Builds the per-resource GraphQL object/input types (output, list-result, create/update/filter
 * inputs, and bulk-result types) from the resource's field sets. Called once per resource by
 * `addResourceFields`; the resulting {@link ResourceGqlTypes} is shared by all of its resolvers.
 */
export function buildResourceTypes(
  gql: GqlModule,
  helpers: SchemaHelpers,
  resource: ResourceDefinition,
  typeName: string,
  fieldSets: ResourceFieldSets
): ResourceGqlTypes {
  const {
    GraphQLObjectType,
    GraphQLInputObjectType,
    GraphQLList,
    GraphQLNonNull,
    GraphQLInt,
    GraphQLID
  } = gql
  const { fieldTypeToOutputGQL, fieldTypeToInputGQL } = helpers
  const { idField, selectableFields, writableFields, filterableFields } = fieldSets

  const OutputType = new GraphQLObjectType({
    name: typeName,
    description: `A ${resource.name ?? typeName} record.`,
    fields: (): GraphQLFieldConfigMap<unknown, GraphQLResolverContext> => {
      const gqlFields: GraphQLFieldConfigMap<unknown, GraphQLResolverContext> = {}
      for (const f of selectableFields) {
        gqlFields[f.name] = { type: fieldTypeToOutputGQL(f.type, f.name === idField) }
      }
      return gqlFields
    }
  }) as GraphQLObjectType

  const ListResultType = new GraphQLObjectType({
    name: `${typeName}ListResult`,
    description: `Paginated list of ${typeName} records.`,
    fields: {
      count: {
        type: new GraphQLNonNull(GraphQLInt),
        description: 'Total matching records (before pagination).'
      },
      results: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(OutputType))),
        description: 'Records for the current page.'
      }
    }
  }) as GraphQLObjectType

  const makeWritableFields = (): GraphQLInputFieldConfigMap => {
    const gqlFields: GraphQLInputFieldConfigMap = {}
    for (const f of writableFields) {
      gqlFields[f.name] = { type: fieldTypeToInputGQL(f.type, false) }
    }
    return gqlFields
  }

  const CreateInputType = new GraphQLInputObjectType({
    name: `${typeName}CreateInput`,
    description: `Fields required to create a ${typeName}.`,
    fields: makeWritableFields
  }) as GraphQLInputObjectType

  const UpdateInputType = new GraphQLInputObjectType({
    name: `${typeName}UpdateInput`,
    description: `Fields to patch on a ${typeName}. All fields are optional.`,
    fields: makeWritableFields
  }) as GraphQLInputObjectType

  const FilterInputType = new GraphQLInputObjectType({
    name: `${typeName}FilterInput`,
    description: `Simple equality filter for listing ${typeName} records.`,
    fields: (): GraphQLInputFieldConfigMap => {
      const gqlFields: GraphQLInputFieldConfigMap = {}
      for (const f of filterableFields) {
        gqlFields[f.name] = { type: fieldTypeToInputGQL(f.type, f.name === idField) }
      }
      return gqlFields
    }
  }) as GraphQLInputObjectType

  const UpdateManyResultType = new GraphQLObjectType({
    name: `${typeName}UpdateManyResult`,
    fields: {
      updated: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLID))),
        description: 'IDs of updated records.'
      },
      results: {
        type: new GraphQLList(OutputType),
        description: 'Updated records (when the repository supports returning them).'
      }
    }
  }) as GraphQLObjectType

  const DeleteManyResultType = new GraphQLObjectType({
    name: `${typeName}DeleteManyResult`,
    fields: {
      deleted: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLID))),
        description: 'IDs of deleted records.'
      }
    }
  }) as GraphQLObjectType

  return {
    OutputType,
    ListResultType,
    CreateInputType,
    UpdateInputType,
    FilterInputType,
    UpdateManyResultType,
    DeleteManyResultType
  }
}
