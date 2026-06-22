import type { OpenApiParameter, OpenApiSpec } from '@/openapi/types.js'
import type { JsonSchema } from '@edium/halifax-types'
import type { CustomEndpointMethod, CustomEndpointOpenApi } from '@/core/customEndpoint.js'
import type { CustomEndpointSchemas } from '@/core/customEndpointValidation.js'

/** The slice of a resolved endpoint the OpenAPI merge needs (satisfied structurally). */
export interface OpenApiEndpoint {
  isPublic: boolean
  validate: CustomEndpointSchemas | undefined
  openapi: CustomEndpointOpenApi | undefined
}

/** Builds OpenAPI `parameters` from an object JSON Schema's `properties` for a given location. */
function paramsFromSchema(
  schema: JsonSchema | undefined,
  location: 'query' | 'path'
): OpenApiParameter[] {
  const properties = (schema as { properties?: Record<string, JsonSchema> } | undefined)?.properties
  if (!properties) return []
  const requiredList = (schema as { required?: unknown }).required
  const required = new Set(Array.isArray(requiredList) ? (requiredList as string[]) : [])
  return Object.entries(properties).map(([name, propSchema]) => ({
    name,
    in: location,
    // Path params are always required; query params follow the schema's `required` list.
    required: location === 'path' ? true : required.has(name),
    schema: propSchema
  }))
}

/**
 * Produces the effective OpenAPI operation metadata: explicit `openapi` merged with anything the
 * `validate` schemas can derive (a `requestBody` from `body`, `parameters` from `query`/`params`).
 * Explicitly-provided metadata always wins. Returns `undefined` when there is nothing to document.
 */
function deriveOpenApi(endpoint: OpenApiEndpoint): CustomEndpointOpenApi | undefined {
  const explicit = endpoint.openapi
  const v = endpoint.validate
  const bodySchema = v?.body?.toJsonSchema?.()
  const derivedParameters = [
    ...paramsFromSchema(v?.params?.toJsonSchema?.(), 'path'),
    ...paramsFromSchema(v?.query?.toJsonSchema?.(), 'query')
  ]
  if (!explicit && !bodySchema && derivedParameters.length === 0) return undefined

  const result: CustomEndpointOpenApi = { ...explicit }
  if (!result.requestBody && bodySchema)
    result.requestBody = { required: true, content: { 'application/json': { schema: bodySchema } } }
  if (!result.parameters && derivedParameters.length > 0) result.parameters = derivedParameters
  return result
}

/** Merges a custom endpoint's metadata into the live OpenAPI spec (no-op when spec/metadata absent). */
export function mergeCustomEndpointOpenApi(
  spec: OpenApiSpec | null,
  method: CustomEndpointMethod,
  path: string,
  endpoint: OpenApiEndpoint
): void {
  const meta = deriveOpenApi(endpoint)
  if (!spec || !meta) return
  const httpMethod = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
  spec.paths[path] ??= {}
  spec.paths[path]![httpMethod] = {
    ...meta,
    responses: meta.responses ?? { '200': { description: 'OK' } },
    // A public endpoint advertises "no security" so docs/Swagger don't render a lock for it.
    ...(endpoint.isPublic ? { security: [] } : {})
  }
}
