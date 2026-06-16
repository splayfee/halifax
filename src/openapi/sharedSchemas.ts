import type { JsonSchema, OpenApiParameter, OpenApiOperation } from './types.js'

type ErrorResponse = { description: string; content: { 'application/json': { schema: JsonSchema } } }

export const correlationIdHeader: OpenApiParameter = {
  name: 'X-Correlation-ID',
  in: 'header',
  description: 'Optional correlation ID echoed back in the response header for request tracing.',
  schema: { type: 'string' }
}

export const sharedSchemas: Record<string, JsonSchema> = {
  ErrorDetail: {
    type: 'object',
    required: ['code', 'message'],
    properties: {
      code: {
        type: 'string',
        description: 'Machine-readable error code (e.g. `NOT_FOUND`, `UNAUTHORIZED`).',
        example: 'NOT_FOUND'
      },
      message: {
        type: 'string',
        description: 'Human-readable error description.',
        example: 'Not found.'
      },
      details: { description: 'Additional structured detail when available.' }
    }
  },
  ErrorResponse: {
    type: 'object',
    required: ['errors'],
    properties: {
      errors: {
        type: 'array',
        items: { $ref: '#/components/schemas/ErrorDetail' }
      }
    }
  },
  QueryFilter: {
    type: 'object',
    description: [
      'A single filter condition or a group of nested conditions used in the query builder.',
      '',
      '**Leaf node** — filter a single field:',
      '```json',
      '{ "field": "status", "comparison": "=", "value": "active" }',
      '```',
      '',
      '**Multi-value** — IN / NOT IN:',
      '```json',
      '{ "field": "role", "comparison": "IN", "value": ["admin", "editor"] }',
      '```',
      '',
      '**Range** — BETWEEN:',
      '```json',
      '{ "field": "age", "comparison": "BETWEEN", "value": [18, 65] }',
      '```',
      '',
      '**Group node** — combine children with AND / OR:',
      '```json',
      '{ "operator": "OR", "children": [',
      '  { "field": "role", "comparison": "=", "value": "admin" },',
      '  { "field": "role", "comparison": "=", "value": "editor" }',
      ']}',
      '```'
    ].join('\n'),
    properties: {
      field: { type: 'string', description: 'Field name to filter on (leaf nodes only).' },
      comparison: {
        type: 'string',
        description: 'Comparison operator.',
        enum: [
          '=', '<>', '<', '>', '<=', '>=',
          'IN', 'NOT IN', 'BETWEEN', 'NOT BETWEEN',
          'LIKE', 'NOT LIKE', 'IS NULL', 'IS NOT NULL',
          'CONTAINS', 'STARTS WITH', 'ENDS WITH'
        ]
      },
      value: {
        description:
          'Scalar value, or array of values for `IN`/`NOT IN`/`BETWEEN`/`NOT BETWEEN`. Omit for `IS NULL` / `IS NOT NULL`.',
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'array', items: {} }
        ]
      },
      operator: {
        type: 'string',
        enum: ['AND', 'OR'],
        description: 'Logical combinator used when `children` is present. Defaults to `AND`.'
      },
      children: {
        type: 'array',
        items: { $ref: '#/components/schemas/QueryFilter' },
        description: 'Nested filter conditions combined with `operator`.'
      }
    }
  },
  QueryOptions: {
    type: 'object',
    description: [
      'Request body for `POST .../query`. All fields are optional.',
      '',
      'The `where` array is evaluated left-to-right with AND precedence over OR — the same',
      'rules as SQL. Use nested `children` groups for complex parenthesised expressions.',
      '',
      '**Example — paginated, filtered, sorted query:**',
      '```json',
      '{',
      '  "where": [',
      '    { "field": "published", "comparison": "=", "value": true },',
      '    { "field": "createdAt", "comparison": ">=", "value": "2024-01-01T00:00:00Z" }',
      '  ],',
      '  "orderBy": [{ "field": "createdAt", "order": "DESC" }],',
      '  "limit": 20,',
      '  "offset": 0,',
      '  "fields": ["id", "title", "createdAt"],',
      '  "include": ["author"]',
      '}',
      '```'
    ].join('\n'),
    properties: {
      where: {
        type: 'array',
        items: { $ref: '#/components/schemas/QueryFilter' },
        description: 'Filter conditions. AND-precedence over OR within the flat list.'
      },
      limit: { type: 'integer', minimum: 0, description: 'Maximum records to return.' },
      offset: { type: 'integer', minimum: 0, default: 0, description: 'Records to skip.' },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Field names to include in each record. Omit to return all selectable fields.'
      },
      orderBy: {
        type: 'array',
        description: 'Sort order. Multiple entries produce multi-column sorting.',
        items: {
          type: 'object',
          required: ['field', 'order'],
          properties: {
            field: { type: 'string', description: 'Field name to sort by (must be sortable).' },
            order: { type: 'string', enum: ['ASC', 'DESC'] }
          }
        }
      },
      include: {
        type: 'array',
        items: { type: 'string' },
        description: 'Relation names to eagerly load (if the resource supports includes).'
      },
      distinct: {
        type: 'array',
        items: { type: 'string' },
        description: 'Field names to de-duplicate results on (maps to SQL DISTINCT ON these columns).'
      }
    }
  }
}

const errorRef = (description: string): ErrorResponse => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
})

export const commonErrors: Partial<Record<string, OpenApiOperation['responses'][string]>> = {
  '401': errorRef('Unauthorized — missing or invalid credentials.'),
  '403': errorRef('Forbidden — valid credentials but insufficient permissions.'),
  '406': errorRef('Not Acceptable — client does not accept `application/json`.'),
  '500': errorRef('Internal Server Error.')
}

export const writeErrors: Partial<Record<string, OpenApiOperation['responses'][string]>> = {
  '415': errorRef('Unsupported Media Type — body must be `application/json`.')
}

export const badRequestError = errorRef(
  'Bad Request — malformed query string, invalid ID, or invalid request body.'
)
export const notFoundError = errorRef('Not Found — the record with the given ID does not exist.')
export const unprocessableError = errorRef(
  'Unprocessable Entity — request body contains unknown or non-writable fields.'
)
export const notImplementedError = errorRef(
  'Not Implemented — the underlying repository does not support this operation.'
)
export const conflictError = errorRef(
  'Conflict — the write was rejected because it would violate a unique constraint.'
)
