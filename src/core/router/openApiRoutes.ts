import type { AuthStrategy } from '@/auth/AuthStrategy.js'
import { generateOpenApiSpec, generateDocsHtml } from '@/openapi/index.js'
import type { OpenApiSpec } from '@/openapi/types.js'
import type { ResourceDefinition } from '@/core/types.js'
import { sendError } from '@/core/errorUtils.js'
import type { CrudApiOptions } from './options.js'
import type { TrackingHttpServer } from './trackingHttpServer.js'

/**
 * Registers the OpenAPI routes (`GET /openapi.json` + Swagger UI at `GET /docs`) and returns the
 * live, mutable spec object — or `null` when OpenAPI is disabled. The spec is serialized on each
 * request (not frozen at startup) so endpoints added later via `addCustomEndpoint` appear in docs
 * without a restart.
 */
export function setupOpenApi(
  tracker: TrackingHttpServer,
  resources: ResourceDefinition[],
  options: CrudApiOptions,
  authStrategy: AuthStrategy
): OpenApiSpec | null {
  if (!options.openapi || options.openapi.enabled === false) return null

  const specPath = options.openapi.specPath ?? '/openapi.json'
  const docsPath = options.openapi.docsPath ?? '/docs'
  const resolvedEnvelope = options.openapi.envelope ?? options.envelope ?? null
  const resolvedScheme = options.openapi.securityScheme ?? authStrategy.openApiScheme?.()
  const openApiOpts = {
    ...options.openapi,
    envelope: resolvedEnvelope,
    ...(resolvedScheme ? { securityScheme: resolvedScheme } : {})
  }
  const spec = generateOpenApiSpec(resources, openApiOpts)
  const docsHtml = generateDocsHtml(specPath, docsPath)
  const requireAuth = options.openapi.requireAuth === true

  tracker.registerRoute('GET', specPath, async (req, res) => {
    try {
      if (requireAuth) await authStrategy.authenticate(req)
      res.setHeader?.('Content-Type', 'application/json')
      res.send?.(JSON.stringify(spec, null, 2))
    } catch (error) {
      await sendError(error, res)
    }
  })

  tracker.registerRoute('GET', docsPath, async (req, res) => {
    try {
      if (requireAuth) await authStrategy.authenticate(req)
      res.setHeader?.('Content-Type', 'text/html; charset=utf-8')
      res.send?.(docsHtml)
    } catch (error) {
      await sendError(error, res)
    }
  })

  return spec
}
