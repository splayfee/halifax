import { GraphQLScalarType, Kind } from 'graphql'
import type { ValueNode } from 'graphql'

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
      return Object.fromEntries(
        ast.fields.map((f) => [f.name.value, parseLiteralToValue(f.value)])
      )
    default:
      return null
  }
}

/**
 * Custom `JSON` scalar that accepts any JSON-serializable value.
 * Used for filter `value1`/`value2` fields in QueryFilterInput and for `object` field types.
 */
export const GraphQLJSON = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value (string, number, boolean, null, array, or object).',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: parseLiteralToValue
})
