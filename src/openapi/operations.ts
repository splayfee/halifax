import type { FieldDefinition } from '@/core/types.js'
import type { JsonSchema, OpenApiParameter, OpenApiSpec } from './types.js'
import {
  badRequestError,
  commonErrors,
  conflictError,
  correlationIdHeader,
  notFoundError,
  notImplementedError,
  unprocessableError,
  writeErrors
} from './sharedSchemas.js'

/** Shared context passed to every per-resource path builder. */
export type ResourceSpecCtx = {
  spec: OpenApiSpec
  schemaBase: string
  tag: string
  basePath: string
  itemPath: string
  envelope: string | null
  writableFields: FieldDefinition[]
  listQueryParams: OpenApiParameter[]
  singleQueryParams: OpenApiParameter[]
  idParam: OpenApiParameter
}

function withEnvelope(schema: JsonSchema, envelope: string | null): JsonSchema {
  if (!envelope) return schema
  return { type: 'object', required: [envelope], properties: { [envelope]: schema } }
}

export function addReadManyPath(ctx: ResourceSpecCtx): void {
  const { spec, schemaBase, tag, basePath, listQueryParams } = ctx
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

export function addCreatePath(ctx: ResourceSpecCtx): void {
  const { spec, schemaBase, tag, basePath, envelope } = ctx
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
      'supports it, otherwise an empty array).'
    ].join('\n'),
    tags: [tag],
    parameters: [correlationIdHeader],
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

export function addUpdateManyPath(ctx: ResourceSpecCtx): void {
  const { spec, schemaBase, tag, basePath, envelope } = ctx
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
        content: { 'application/json': { schema: withEnvelope(updateManyResponseBody, envelope) } }
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

export function addDeleteManyPath(ctx: ResourceSpecCtx): void {
  const { spec, schemaBase, tag, basePath, envelope } = ctx
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
        content: { 'application/json': { schema: withEnvelope(deleteManyResponseBody, envelope) } }
      },
      '400': badRequestError,
      '422': unprocessableError,
      '501': notImplementedError,
      ...commonErrors,
      ...writeErrors
    }
  }
}

export function addQueryPath(ctx: ResourceSpecCtx): void {
  const { spec, schemaBase, tag, basePath } = ctx
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

export function addReadOnePath(ctx: ResourceSpecCtx): void {
  const { spec, schemaBase, tag, itemPath, envelope, singleQueryParams } = ctx
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

export function addUpdateOnePath(ctx: ResourceSpecCtx): void {
  const { spec, schemaBase, tag, itemPath, envelope, idParam } = ctx
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

export function addUpsertOnePath(ctx: ResourceSpecCtx): void {
  const { spec, schemaBase, tag, itemPath, envelope, idParam } = ctx
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

export function addDeleteOnePath(ctx: ResourceSpecCtx): void {
  const { spec, schemaBase, tag, itemPath, envelope, idParam } = ctx
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
