import type { SecurityScheme } from '@/auth/AuthStrategy.js'

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

export type JsonSchema = {
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

export type OpenApiParameter = {
  name: string
  in: 'query' | 'path' | 'header'
  description?: string
  required?: boolean
  schema: JsonSchema
}

export type OpenApiOperation = {
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

export type OpenApiSecuritySchemeObject =
  | { type: 'apiKey'; in: string; name: string; description?: string }
  | { type: 'http'; scheme: string; bearerFormat?: string; description?: string }

export type OpenApiSpec = {
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
