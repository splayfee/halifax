import type {
  GraphQLScalarType,
  GraphQLOutputType,
  GraphQLInputType,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInputFieldConfigMap,
  ValueNode
} from 'graphql'
import type { FieldType } from '@/core/types.js'
import { HttpError } from '@/errors/HttpError.js'
import { statusCodeMap } from '@/core/errorUtils.js'

type GqlModule = typeof import('graphql')

export type SchemaHelpers = {
  GraphQLJSON: GraphQLScalarType
  SortDirectionEnum: GraphQLEnumType
  OrderByInput: GraphQLInputObjectType
  QueryFilterInput: GraphQLInputObjectType
  fieldTypeToOutputGQL: (type: FieldType | undefined, isId: boolean) => GraphQLOutputType
  fieldTypeToInputGQL: (type: FieldType | undefined, isId: boolean) => GraphQLInputType
  toGraphQLError: (error: unknown) => never
}

export function buildSchemaHelpers(gql: GqlModule): SchemaHelpers {
  const {
    GraphQLScalarType,
    GraphQLEnumType,
    GraphQLInputObjectType,
    GraphQLList,
    GraphQLNonNull,
    GraphQLString,
    GraphQLInt,
    GraphQLFloat,
    GraphQLBoolean,
    GraphQLID,
    GraphQLError,
    Kind
  } = gql

  // ─── JSON scalar ────────────────────────────────────────────────────────────

  function parseLiteralToValue(ast: ValueNode): unknown {
    switch (ast.kind) {
      case Kind.STRING:
        return ast.value
      case Kind.BOOLEAN:
        return ast.value
      case Kind.INT:
        return parseInt(ast.value, 10)
      case Kind.FLOAT:
        return parseFloat(ast.value)
      case Kind.NULL:
        return null
      case Kind.LIST:
        return ast.values.map(parseLiteralToValue)
      case Kind.OBJECT:
        return Object.fromEntries(ast.fields.map((f) => [f.name.value, parseLiteralToValue(f.value)]))
      default:
        return null
    }
  }

  const GraphQLJSON = new GraphQLScalarType({
    name: 'JSON',
    description: 'Arbitrary JSON value (string, number, boolean, null, array, or object).',
    serialize: (value) => value,
    parseValue: (value) => value,
    parseLiteral: parseLiteralToValue
  })

  // ─── Field type converters ───────────────────────────────────────────────────

  function fieldTypeToOutputGQL(type: FieldType | undefined, isId: boolean): GraphQLOutputType {
    if (isId) return GraphQLID
    switch (type) {
      case 'integer': return GraphQLInt
      case 'number': return GraphQLFloat
      case 'boolean': return GraphQLBoolean
      case 'object': return GraphQLJSON
      case 'string':
      default: return GraphQLString
    }
  }

  function fieldTypeToInputGQL(type: FieldType | undefined, isId: boolean): GraphQLInputType {
    if (isId) return GraphQLID
    switch (type) {
      case 'integer': return GraphQLInt
      case 'number': return GraphQLFloat
      case 'boolean': return GraphQLBoolean
      case 'object': return GraphQLJSON
      case 'string':
      default: return GraphQLString
    }
  }

  // ─── Error helper ────────────────────────────────────────────────────────────

  function toGraphQLError(error: unknown): never {
    if (error instanceof GraphQLError) throw error
    if (error instanceof HttpError) {
      throw new GraphQLError(error.message, {
        extensions: {
          code: statusCodeMap[error.status] ?? 'INTERNAL_ERROR',
          status: error.status,
          ...(error.details !== undefined ? { details: error.details } : {})
        }
      })
    }
    throw new GraphQLError('Internal server error', {
      extensions: { code: 'INTERNAL_ERROR', status: 500 }
    })
  }

  // ─── Shared singleton input types ────────────────────────────────────────────

  const SortDirectionEnum = new GraphQLEnumType({
    name: 'SortDirection',
    description: 'Sort direction for orderBy arguments.',
    values: {
      asc: { value: 'asc', description: 'Ascending order.' },
      desc: { value: 'desc', description: 'Descending order.' }
    }
  })

  const OrderByInput = new GraphQLInputObjectType({
    name: 'OrderByInput',
    description: 'A sort expression pairing a field name with a direction.',
    fields: {
      field: { type: new GraphQLNonNull(GraphQLString), description: 'Field name to sort by.' },
      direction: { type: new GraphQLNonNull(SortDirectionEnum), description: 'Sort direction.' }
    }
  })

  const QueryFilterInput = new GraphQLInputObjectType({
    name: 'QueryFilterInput',
    description:
      'A single filter condition (leaf) or a group of nested conditions. ' +
      'Leaf: set field, comparison, and value1. ' +
      'Group: set operator and children.',
    fields: (): GraphQLInputFieldConfigMap => ({
      field: { type: GraphQLString, description: 'Field name to filter on (leaf nodes only).' },
      comparison: {
        type: GraphQLString,
        description:
          'Comparison operator: =, <>, <, >, <=, >=, IN, NOT IN, BETWEEN, NOT BETWEEN, ' +
          'LIKE, NOT LIKE, IS NULL, IS NOT NULL, CONTAINS, STARTS WITH, ENDS WITH.'
      },
      value1: { type: GraphQLJSON, description: 'Primary filter value (scalar or array for IN/BETWEEN operators).' },
      value2: { type: GraphQLJSON, description: 'Secondary value for BETWEEN / NOT BETWEEN operators.' },
      operator: {
        type: GraphQLString,
        description: 'Logical combinator for the flat where array: AND or OR. Required on all but the last element.'
      },
      children: {
        type: new GraphQLList(QueryFilterInput),
        description: 'Nested filter conditions combined with the operator.'
      }
    })
  })

  return {
    GraphQLJSON,
    SortDirectionEnum,
    OrderByInput,
    QueryFilterInput,
    fieldTypeToOutputGQL,
    fieldTypeToInputGQL,
    toGraphQLError
  }
}
