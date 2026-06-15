import {
  defaultCrudPermissions,
  type FieldDefinition,
  type FieldType,
  type ResourceDefinition
} from '@/core/types.js'
import type { SecurityScheme } from '@/auth/AuthStrategy.js'
import {
  mergeFieldDefinitions,
  mergeRelationDefinitions,
  normalizeEnvelope
} from '@/core/fields.js'

/** Options for OpenAPI spec generation and the built-in docs UI. */
export interface OpenApiOptions {
  /**
   * Set `false` to disable OpenAPI entirely (routes not registered, spec not generated).
   * Useful for conditionally enabling in non-production environments:
   *
   * ```ts
   * openapi: {
   *   enabled: process.env.NODE_ENV !== 'production',
   *   title: 'My API'
   * }
   * ```
   *
   * Defaults to `true` when the `openapi` option object is present.
   */
  enabled?: boolean
  /** API title shown in the docs. Defaults to `'Halifax API'`. */
  title?: string
  /** API version string shown in the docs. Defaults to `'1.0.0'`. */
  version?: string
  /** Optional markdown description shown at the top of the docs. */
  description?: string
  /** Server URLs listed in the spec (e.g. `[{ url: 'https://api.example.com/v1' }]`). */
  servers?: Array<{ url: string; description?: string }>
  /**
   * API-wide response envelope key — mirrors the `envelope` option on `CrudApiOptions`.
   * When set, every success response body is wrapped under this key.
   * Per-resource `ResourceDefinition.envelope` takes precedence.
   */
  envelope?: string | null
  /**
   * Path for the raw OpenAPI JSON endpoint, relative to the router mount point.
   * Defaults to `'/openapi.json'` → full path is `<mountPoint>/openapi.json`.
   */
  specPath?: string
  /**
   * Path for the Swagger UI docs page, relative to the router mount point.
   * Defaults to `'/docs'` → full path is `<mountPoint>/docs`.
   */
  docsPath?: string
  /**
   * OpenAPI security scheme to document. When provided, Halifax adds the scheme to
   * `components/securitySchemes` and applies it globally to all operations.
   *
   * This is auto-populated from the `authStrategy` when it implements `openApiScheme()`.
   * You can override it here if you use a custom strategy or want a different description.
   *
   * @example API key
   * ```ts
   * securityScheme: { type: 'apiKey', in: 'header', name: 'X-Api-Key' }
   * ```
   * @example Bearer JWT
   * ```ts
   * securityScheme: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
   * ```
   */
  securityScheme?: SecurityScheme
  /**
   * When `true`, the `/openapi.json` and `/docs` routes require authentication via the
   * configured `authStrategy` — unauthenticated callers receive 401/403 just like any
   * other protected route. Defaults to `false` (docs are publicly accessible).
   */
  requireAuth?: boolean
}

// ─── Internal OpenAPI 3.1 types ───────────────────────────────────────────────

type JsonSchema = {
  type?: string | string[]
  format?: string
  properties?: Record<string, JsonSchema>
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  required?: string[]
  description?: string
  nullable?: boolean
  $ref?: string
  enum?: unknown[]
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  minimum?: number
  default?: unknown
  example?: unknown
  readOnly?: boolean
}

type OpenApiParameter = {
  name: string
  in: 'query' | 'path' | 'header'
  description?: string
  required?: boolean
  schema: JsonSchema
}

type OpenApiOperation = {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: OpenApiParameter[]
  requestBody?: {
    required: boolean
    content: { 'application/json': { schema: JsonSchema } }
  }
  responses: Record<
    string,
    { description: string; content?: { 'application/json': { schema: JsonSchema } } }
  >
}

type OpenApiSecuritySchemeObject =
  | { type: 'apiKey'; in: string; name: string; description?: string }
  | { type: 'http'; scheme: string; bearerFormat?: string; description?: string }

type OpenApiSpec = {
  openapi: '3.1.0'
  info: { title: string; version: string; description?: string }
  servers?: Array<{ url: string; description?: string }>
  security?: Array<Record<string, []>>
  paths: Record<
    string,
    Partial<Record<'get' | 'post' | 'put' | 'patch' | 'delete', OpenApiOperation>>
  >
  components: {
    schemas: Record<string, JsonSchema>
    securitySchemes?: Record<string, OpenApiSecuritySchemeObject>
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Exhaustive map from every FieldType to its JSON Schema type string.
// Adding a new FieldType causes a compile error here until the map is updated — no switch to edit.
const FIELD_TYPE_TO_JSON_SCHEMA: Record<FieldType, string> = {
  string: 'string',
  integer: 'integer',
  number: 'number',
  boolean: 'boolean',
  object: 'object'
}

function fieldToSchema(field: Pick<FieldDefinition, 'type' | 'format'>): JsonSchema {
  const type = field.type ? FIELD_TYPE_TO_JSON_SCHEMA[field.type] : 'string'
  return field.format ? { type, format: field.format } : { type }
}

function toPascalCase(routePrefix: string): string {
  return routePrefix
    .split(/[-_/\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

function mergeFields(resource: ResourceDefinition): FieldDefinition[] {
  const idField = resource.repository?.idField ?? 'id'
  return mergeFieldDefinitions(resource).map((f) => ({
    ...f,
    writable: f.name === idField ? f.writable === true : f.writable !== false
  }))
}

// Wraps a schema under an envelope key if one is active.
function withEnvelope(schema: JsonSchema, envelope: string | null): JsonSchema {
  if (!envelope) return schema
  return {
    type: 'object',
    required: [envelope],
    properties: { [envelope]: schema }
  }
}

function schemeToObject(scheme: SecurityScheme): OpenApiSecuritySchemeObject {
  if (scheme.type === 'apiKey')
    return {
      type: 'apiKey',
      in: scheme.in,
      name: scheme.name,
      ...(scheme.description ? { description: scheme.description } : {})
    }
  if (scheme.scheme === 'bearer')
    return {
      type: 'http',
      scheme: 'bearer',
      ...(scheme.bearerFormat ? { bearerFormat: scheme.bearerFormat } : {}),
      ...(scheme.description ? { description: scheme.description } : {})
    }
  return {
    type: 'http',
    scheme: scheme.scheme,
    ...(scheme.description ? { description: scheme.description } : {})
  }
}

function schemeName(scheme: SecurityScheme): string {
  if (scheme.type === 'apiKey') return scheme.in === 'cookie' ? 'SessionAuth' : 'ApiKeyAuth'
  if (scheme.scheme === 'bearer') return 'BearerAuth'
  return 'BasicAuth'
}

// ─── Shared request headers ───────────────────────────────────────────────────

const correlationIdHeader: OpenApiParameter = {
  name: 'X-Correlation-ID',
  in: 'header',
  description: 'Optional correlation ID echoed back in the response header for request tracing.',
  schema: { type: 'string' }
}

// ─── Shared error/response schemas ───────────────────────────────────────────

const sharedSchemas: Record<string, JsonSchema> = {
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
          '=',
          '<>',
          '<',
          '>',
          '<=',
          '>=',
          'IN',
          'NOT IN',
          'BETWEEN',
          'NOT BETWEEN',
          'LIKE',
          'NOT LIKE',
          'IS NULL',
          'IS NOT NULL',
          'CONTAINS',
          'STARTS WITH',
          'ENDS WITH'
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

// ─── Shared error responses ───────────────────────────────────────────────────

const errorRef = (
  description: string
): { description: string; content: { 'application/json': { schema: JsonSchema } } } => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
})

const commonErrors = {
  '401': errorRef('Unauthorized — missing or invalid credentials.'),
  '403': errorRef('Forbidden — valid credentials but insufficient permissions.'),
  '406': errorRef('Not Acceptable — client does not accept `application/json`.'),
  '500': errorRef('Internal Server Error.')
}

const writeErrors = {
  '415': errorRef('Unsupported Media Type — body must be `application/json`.')
}

const badRequestError = errorRef(
  'Bad Request — malformed query string, invalid ID, or invalid request body.'
)
const notFoundError = errorRef('Not Found — the record with the given ID does not exist.')
const unprocessableError = errorRef(
  'Unprocessable Entity — request body contains unknown or non-writable fields.'
)
const notImplementedError = errorRef(
  'Not Implemented — the underlying repository does not support this operation.'
)
const conflictError = errorRef(
  'Conflict — the write was rejected because it would violate a unique constraint.'
)

// ─── Main export ──────────────────────────────────────────────────────────────

export function generateOpenApiSpec(
  resources: ResourceDefinition[],
  options: OpenApiOptions = {}
): OpenApiSpec {
  const globalEnvelope = normalizeEnvelope(options.envelope)

  const scheme = options.securityScheme
  const securityName = scheme ? schemeName(scheme) : undefined

  const spec: OpenApiSpec = {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'Halifax API',
      version: options.version ?? '1.0.0',
      ...(options.description ? { description: options.description } : {})
    },
    ...(options.servers?.length ? { servers: options.servers } : {}),
    ...(securityName ? { security: [{ [securityName]: [] }] } : {}),
    paths: {},
    components: {
      schemas: { ...sharedSchemas },
      ...(scheme && securityName
        ? { securitySchemes: { [securityName]: schemeToObject(scheme) } }
        : {})
    }
  }

  // Note: resources here are the *raw* definitions as passed by the caller — they have NOT
  // been through crudRouter's `normalizeResource()`. That means `mergeFields` and
  // `mergeRelationDefinitions` below re-derive the same merged views that the router already
  // computed at startup. This is intentional: the spec generator is a standalone function
  // (called outside the router for static generation tooling), so it can't rely on the
  // router's normalized state. If crudRouter ever caches normalized resources, pass them
  // here instead to avoid the duplicate merge work.
  for (const resource of resources) {
    const permissions = { ...defaultCrudPermissions, ...resource.permissions }
    const fields = mergeFields(resource)
    const relations = mergeRelationDefinitions(resource)
    const idField = resource.repository?.idField ?? 'id'
    const schemaBase = toPascalCase(resource.routePrefix)
    const tag = resource.name ?? schemaBase
    const basePath = `/${resource.routePrefix}`

    // Resolve envelope: per-resource wins over API-wide default.
    const envelope =
      resource.envelope !== undefined ? normalizeEnvelope(resource.envelope) : globalEnvelope

    // ─── Component schemas ───────────────────────────────────────────────────

    const selectableFields = fields.filter((f) => f.selectable !== false)
    const readProperties: Record<string, JsonSchema> = {}
    for (const f of selectableFields) {
      readProperties[f.name] = {
        ...fieldToSchema(f),
        ...(f.writable === false ? { readOnly: true } : {})
      }
    }
    spec.components.schemas[schemaBase] = { type: 'object', properties: readProperties }

    const writableFields = fields.filter((f) => f.name !== idField && f.writable !== false)
    const writeProperties: Record<string, JsonSchema> = Object.fromEntries(
      writableFields.map((f) => [f.name, fieldToSchema(f)])
    )
    spec.components.schemas[`${schemaBase}Create`] = { type: 'object', properties: writeProperties }
    spec.components.schemas[`${schemaBase}Update`] = { type: 'object', properties: writeProperties }

    // List response: { count: number, results: TRecord[] }  (Halifax's ListResult / QueryResult shape)
    const listResultSchema: JsonSchema = {
      type: 'object',
      required: ['count', 'results'],
      properties: {
        count: { type: 'integer', description: 'Total matching records before pagination.' },
        results: { type: 'array', items: { $ref: `#/components/schemas/${schemaBase}` } }
      }
    }
    spec.components.schemas[`${schemaBase}List`] = withEnvelope(listResultSchema, envelope)

    // ─── Shared parameters ───────────────────────────────────────────────────

    const includableRelations = relations.filter((r) => r.includable !== false)
    const includeParam: OpenApiParameter | undefined =
      includableRelations.length > 0
        ? {
            name: 'include',
            in: 'query',
            description: `Comma-separated relation names to eagerly load. Available: \`${includableRelations.map((r) => r.name).join('`, `')}\`.`,
            schema: { type: 'string', enum: includableRelations.map((r) => r.name) }
          }
        : undefined

    const sortableFieldNames = fields.filter((f) => f.sortable !== false).map((f) => f.name)
    const selectableFieldNames = selectableFields.map((f) => f.name)
    const filterableFields = fields.filter((f) => f.filterable !== false)

    const fieldsParam: OpenApiParameter = {
      name: 'fields',
      in: 'query',
      description: `Comma-separated field names to include in each record. Available: \`${selectableFieldNames.join('`, `')}\`.`,
      schema: { type: 'string' }
    }

    const orderParam: OpenApiParameter = {
      name: 'order',
      in: 'query',
      description: `Sort expression. Format: \`field:asc\` or \`field:desc\`, comma-separated for multiple columns. Sortable fields: \`${sortableFieldNames.join('`, `')}\`.`,
      schema: {
        type: 'string',
        example: sortableFieldNames[0] ? `${sortableFieldNames[0]}:desc` : 'id:desc'
      }
    }

    const filterParams: OpenApiParameter[] = filterableFields.map((f) => ({
      name: f.name,
      in: 'query' as const,
      description: `Equality filter on \`${f.name}\`. For range / pattern filters use \`POST .../query\`.`,
      schema: fieldToSchema(f)
    }))

    const listQueryParams: OpenApiParameter[] = [
      {
        name: 'limit',
        in: 'query',
        description: 'Maximum records to return. Defaults to resource limit (up to 5000).',
        schema: { type: 'integer', minimum: 0 }
      },
      {
        name: 'offset',
        in: 'query',
        description: 'Records to skip for pagination. Defaults to `0`.',
        schema: { type: 'integer', minimum: 0, default: 0 }
      },
      fieldsParam,
      orderParam,
      ...(includeParam ? [includeParam] : []),
      ...filterParams,
      correlationIdHeader
    ]

    const idParam: OpenApiParameter = {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Resource identifier (integer, UUID, or ObjectId).',
      schema: { type: 'string' }
    }

    const singleQueryParams: OpenApiParameter[] = [
      idParam,
      fieldsParam,
      ...(includeParam ? [includeParam] : []),
      correlationIdHeader
    ]

    // ─── GET /resource (readMany) ────────────────────────────────────────────

    if (permissions.allowReadMany) {
      spec.paths[basePath] ??= {}
      spec.paths[basePath]!.get = {
        operationId: `list${schemaBase}`,
        summary: `List ${tag}`,
        description: [
          `Returns a paginated list of ${tag} records.`,
          '',
          'Use `?limit` and `?offset` for pagination. Use `?fieldName=value` for simple equality',
          'filters. For advanced filtering (range, LIKE, IN, nested OR/AND) use',
          `\`POST ${basePath}/query\` instead.`
        ].join('\n'),
        tags: [tag],
        parameters: listQueryParams,
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${schemaBase}List` } }
            }
          },
          '400': badRequestError,
          ...commonErrors
        }
      }
    }

    // ─── POST /resource (create) ─────────────────────────────────────────────

    if (permissions.allowCreate) {
      spec.paths[basePath] ??= {}
      const singleResponse = withEnvelope({ $ref: `#/components/schemas/${schemaBase}` }, envelope)
      const arrayResponse = withEnvelope(
        { type: 'array', items: { $ref: `#/components/schemas/${schemaBase}` } },
        envelope
      )
      spec.paths[basePath]!.post = {
        operationId: `create${schemaBase}`,
        summary: `Create ${tag}`,
        description: [
          `Creates one or many ${tag} records.`,
          '',
          'Pass a single object to create one record (returns the created record).',
          'Pass an array to bulk-create (returns the created records when the repository',
          'supports it, otherwise an empty array).',
          '',
          '`Idempotency-Key` header is supported: repeated requests with the same key',
          'are de-duplicated by the repository when it implements idempotency.'
        ].join('\n'),
        tags: [tag],
        parameters: [
          correlationIdHeader,
          {
            name: 'Idempotency-Key',
            in: 'header',
            description:
              'Optional idempotency key. Duplicate requests with the same key return the original response.',
            schema: { type: 'string' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: `#/components/schemas/${schemaBase}Create` },
                  { type: 'array', items: { $ref: `#/components/schemas/${schemaBase}Create` } }
                ]
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Created',
            content: { 'application/json': { schema: { oneOf: [singleResponse, arrayResponse] } } }
          },
          '400': badRequestError,
          '409': conflictError,
          '422': unprocessableError,
          ...commonErrors,
          ...writeErrors
        }
      }
    }

    // ─── PATCH /resource (updateMany) ────────────────────────────────────────

    if (permissions.allowUpdateMany) {
      spec.paths[basePath] ??= {}
      const updateManyBodySchema: JsonSchema = {
        type: 'object',
        required: ['update'],
        description: [
          'Combines a query (to select which records to update) with the update payload.',
          '',
          'The `update` field contains the fields to set. All other top-level fields are',
          'interpreted as `QueryOptions` — use `where` (required) to target records.',
          '',
          '**Example:**',
          '```json',
          '{',
          '  "where": [{ "field": "status", "comparison": "=", "value": "draft" }],',
          '  "update": { "status": "archived" }',
          '}',
          '```'
        ].join('\n'),
        properties: {
          update: {
            $ref: `#/components/schemas/${schemaBase}Update`,
            description:
              'Fields to apply to every matched record. At least one writable field required.'
          } as JsonSchema,
          where: {
            type: 'array',
            items: { $ref: '#/components/schemas/QueryFilter' },
            description:
              '**Required.** At least one filter is mandatory to prevent unintended full-table updates.'
          },
          limit: { type: 'integer', minimum: 0, description: 'Maximum records to update.' },
          offset: { type: 'integer', minimum: 0, description: 'Records to skip before updating.' },
          orderBy: {
            type: 'array',
            items: {
              type: 'object',
              required: ['field', 'order'],
              properties: {
                field: { type: 'string' },
                order: { type: 'string', enum: ['ASC', 'DESC'] }
              }
            }
          }
        }
      }
      const updateManyResponseBody: JsonSchema = {
        type: 'object',
        required: ['updated'],
        properties: {
          updated: { type: 'array', items: {}, description: 'IDs of updated records.' },
          results: {
            type: 'array',
            items: { $ref: `#/components/schemas/${schemaBase}` },
            description: 'Updated records (when the repository supports returning them).'
          }
        }
      }
      spec.paths[basePath]!.patch = {
        operationId: `updateMany${schemaBase}`,
        summary: `Bulk-update ${tag}`,
        tags: [tag],
        parameters: [correlationIdHeader],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: updateManyBodySchema } }
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: withEnvelope(updateManyResponseBody, envelope) }
            }
          },
          '400': badRequestError,
          '409': conflictError,
          '422': unprocessableError,
          '501': notImplementedError,
          ...commonErrors,
          ...writeErrors
        }
      }
    }

    // ─── DELETE /resource (deleteMany) ───────────────────────────────────────

    if (permissions.allowDeleteMany) {
      spec.paths[basePath] ??= {}
      const deleteManyBodySchema: JsonSchema = {
        allOf: [{ $ref: '#/components/schemas/QueryOptions' }],
        description: [
          'Full `QueryOptions` body. `where` is **required** — at least one filter',
          'must be present to prevent unintended full-table deletes.',
          '',
          '**Example:**',
          '```json',
          '{',
          '  "where": [{ "field": "deletedAt", "comparison": "IS NOT NULL" }]',
          '}',
          '```'
        ].join('\n')
      }
      const deleteManyResponseBody: JsonSchema = {
        type: 'object',
        required: ['deleted'],
        properties: {
          deleted: { type: 'array', items: {}, description: 'IDs or records of the deleted rows.' }
        }
      }
      spec.paths[basePath]!.delete = {
        operationId: `deleteMany${schemaBase}`,
        summary: `Bulk-delete ${tag}`,
        tags: [tag],
        parameters: [correlationIdHeader],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: deleteManyBodySchema } }
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: withEnvelope(deleteManyResponseBody, envelope) }
            }
          },
          '400': badRequestError,
          '422': unprocessableError,
          '501': notImplementedError,
          ...commonErrors,
          ...writeErrors
        }
      }
    }

    // ─── POST /resource/query (readManyWithQueryBuilder) ─────────────────────

    if (permissions.allowReadManyWithQueryBuilder) {
      const queryPath = `${basePath}/query`
      spec.paths[queryPath] ??= {}
      spec.paths[queryPath]!.post = {
        operationId: `query${schemaBase}`,
        summary: `Query ${tag}`,
        description: [
          `Advanced endpoint for filtering, sorting, and paginating ${tag} records.`,
          '',
          'Accepts a full `QueryOptions` body — all fields are optional, so an empty body',
          '`{}` behaves identically to `GET /<resource>`. Only use this endpoint when you need',
          'operators beyond simple equality (e.g. `>=`, `LIKE`, `IN`, nested OR groups).',
          '',
          '### Supported comparison operators',
          '',
          '| Operator | Meaning |',
          '|---|---|',
          '| `=` | Equals |',
          '| `<>` | Not equals |',
          '| `<` `>` `<=` `>=` | Numeric / date comparison |',
          '| `IN` / `NOT IN` | Membership test (pass array as value) |',
          '| `BETWEEN` / `NOT BETWEEN` | Range test (pass `[min, max]` as value) |',
          '| `LIKE` / `NOT LIKE` | SQL LIKE pattern (`%` wildcard) |',
          '| `CONTAINS` | Substring match |',
          '| `STARTS WITH` | Prefix match |',
          '| `ENDS WITH` | Suffix match |',
          '| `IS NULL` / `IS NOT NULL` | Null check (no value needed) |',
          '',
          '### AND / OR precedence',
          '',
          'Flat `where` arrays use **AND-precedence over OR** (same as SQL).',
          'Use nested `children` groups for explicit parenthesisation.'
        ].join('\n'),
        tags: [tag],
        parameters: [correlationIdHeader],
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/QueryOptions' } } }
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${schemaBase}List` } }
            }
          },
          '400': badRequestError,
          '501': notImplementedError,
          ...commonErrors,
          ...writeErrors
        }
      }
    }

    // ─── GET /resource/{id} (readOne) ────────────────────────────────────────

    const itemPath = `${basePath}/{id}`
    if (permissions.allowReadOne) {
      spec.paths[itemPath] ??= {}
      spec.paths[itemPath]!.get = {
        operationId: `get${schemaBase}`,
        summary: `Get ${tag} by ID`,
        tags: [tag],
        parameters: singleQueryParams,
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: withEnvelope({ $ref: `#/components/schemas/${schemaBase}` }, envelope)
              }
            }
          },
          '400': badRequestError,
          '404': notFoundError,
          ...commonErrors
        }
      }
    }

    // ─── PATCH /resource/{id} (updateOne) ────────────────────────────────────

    if (permissions.allowUpdateOne) {
      spec.paths[itemPath] ??= {}
      spec.paths[itemPath]!.patch = {
        operationId: `update${schemaBase}`,
        summary: `Update ${tag}`,
        description: `Partially updates a ${tag} record. Only the fields present in the body are changed.`,
        tags: [tag],
        parameters: [idParam, correlationIdHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: `#/components/schemas/${schemaBase}Update` } }
          }
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: withEnvelope({ $ref: `#/components/schemas/${schemaBase}` }, envelope)
              }
            }
          },
          '400': badRequestError,
          '404': notFoundError,
          '409': conflictError,
          '422': unprocessableError,
          ...commonErrors,
          ...writeErrors
        }
      }
    }

    // ─── PUT /resource/{id} (upsertOne) ──────────────────────────────────────

    if (permissions.allowUpsertOne) {
      spec.paths[itemPath] ??= {}
      spec.paths[itemPath]!.put = {
        operationId: `upsert${schemaBase}`,
        summary: `Upsert ${tag}`,
        description: [
          `Creates or replaces a ${tag} record at the given ID.`,
          '',
          'If a record with the given `id` already exists it is replaced; otherwise a new',
          'record is created. Always returns the resulting record with HTTP `200`.'
        ].join('\n'),
        tags: [tag],
        parameters: [idParam, correlationIdHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: `#/components/schemas/${schemaBase}Create` } }
          }
        },
        responses: {
          '200': {
            description: 'OK — record created or replaced.',
            content: {
              'application/json': {
                schema: withEnvelope({ $ref: `#/components/schemas/${schemaBase}` }, envelope)
              }
            }
          },
          '400': badRequestError,
          '409': conflictError,
          '422': unprocessableError,
          '501': notImplementedError,
          ...commonErrors,
          ...writeErrors
        }
      }
    }

    // ─── DELETE /resource/{id} (deleteOne) ───────────────────────────────────

    if (permissions.allowDeleteOne) {
      spec.paths[itemPath] ??= {}
      const deleteOneResponse: JsonSchema = withEnvelope(
        {
          type: 'object',
          required: ['deleted'],
          properties: { deleted: { type: 'boolean', example: true } }
        },
        envelope
      )
      spec.paths[itemPath]!.delete = {
        operationId: `delete${schemaBase}`,
        summary: `Delete ${tag}`,
        tags: [tag],
        parameters: [idParam, correlationIdHeader],
        responses: {
          '200': {
            description: 'Deleted — returns `{ "deleted": true }`.',
            content: { 'application/json': { schema: deleteOneResponse } }
          },
          '400': badRequestError,
          '404': notFoundError,
          ...commonErrors,
          ...writeErrors
        }
      }
    }
  }

  return spec
}
