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
import { toPascalCase } from '@/core/stringUtils.js'
import type {
  OpenApiOptions,
  OpenApiSpec,
  OpenApiSecuritySchemeObject,
  OpenApiParameter
} from './types.js'
import { sharedSchemas, correlationIdHeader } from './sharedSchemas.js'
import {
  addReadManyPath,
  addCreatePath,
  addUpdateManyPath,
  addDeleteManyPath,
  addQueryPath,
  addReadOnePath,
  addUpdateOnePath,
  addUpsertOnePath,
  addDeleteOnePath,
  type ResourceSpecCtx
} from './operations.js'

export type { OpenApiOptions }

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

function fieldToSchema(field: Pick<FieldDefinition, 'type' | 'format'>): {
  type: string
  format?: string
} {
  const type = field.type ? FIELD_TYPE_TO_JSON_SCHEMA[field.type] : 'string'
  return field.format ? { type, format: field.format } : { type }
}

function mergeFields(resource: ResourceDefinition): FieldDefinition[] {
  const idField = resource.repository?.idField ?? 'id'
  return mergeFieldDefinitions(resource).map((f) => ({
    ...f,
    writable: f.name === idField ? f.writable === true : f.writable !== false
  }))
}

function withEnvelope(schema: object, envelope: string | null): object {
  if (!envelope) return schema
  return { type: 'object', required: [envelope], properties: { [envelope]: schema } }
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
    const itemPath = `${basePath}/{id}`

    const envelope =
      resource.envelope !== undefined ? normalizeEnvelope(resource.envelope) : globalEnvelope

    // ─── Component schemas ───────────────────────────────────────────────────

    const selectableFields = fields.filter((f) => f.selectable !== false)
    const readProperties: Record<string, object> = {}
    for (const f of selectableFields) {
      readProperties[f.name] = {
        ...fieldToSchema(f),
        ...(f.writable === false ? { readOnly: true } : {})
      }
    }
    spec.components.schemas[schemaBase] = { type: 'object', properties: readProperties }

    const writableFields = fields.filter((f) => f.name !== idField && f.writable !== false)
    const writeProperties = Object.fromEntries(
      writableFields.map((f) => [f.name, fieldToSchema(f)])
    )
    spec.components.schemas[`${schemaBase}Create`] = { type: 'object', properties: writeProperties }
    spec.components.schemas[`${schemaBase}Update`] = { type: 'object', properties: writeProperties }

    const listResultSchema = {
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
    const idParam: OpenApiParameter = {
      name: 'id',
      in: 'path',
      required: true,
      description: 'Resource identifier (integer, UUID, or ObjectId).',
      schema: { type: 'string' }
    }
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
    const singleQueryParams: OpenApiParameter[] = [
      idParam,
      fieldsParam,
      ...(includeParam ? [includeParam] : []),
      correlationIdHeader
    ]

    // ─── Path operations ─────────────────────────────────────────────────────

    const ctx: ResourceSpecCtx = {
      spec,
      schemaBase,
      tag,
      basePath,
      itemPath,
      envelope,
      writableFields,
      listQueryParams,
      singleQueryParams,
      idParam
    }

    if (permissions.allowReadMany) addReadManyPath(ctx)
    if (permissions.allowCreate) addCreatePath(ctx)
    if (permissions.allowUpdateMany) addUpdateManyPath(ctx)
    if (permissions.allowDeleteMany) addDeleteManyPath(ctx)
    if (permissions.allowReadManyWithQueryBuilder) addQueryPath(ctx)
    if (permissions.allowReadOne) addReadOnePath(ctx)
    if (permissions.allowUpdateOne) addUpdateOnePath(ctx)
    if (permissions.allowUpsertOne) addUpsertOnePath(ctx)
    if (permissions.allowDeleteOne) addDeleteOnePath(ctx)
  }

  return spec
}
