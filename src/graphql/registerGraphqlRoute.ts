import { graphql, parse, validate } from 'graphql'
import { buildGraphQLSchema } from './schema.js'
import { generateGraphiQLHtml } from './graphiql.js'
import type { GraphQLOptions, GraphQLRequestBody, GraphQLResourceContext } from './types.js'
import type { AuthStrategy } from '@/auth/strategies/types.js'
import type { HttpServer } from '@/core/types.js'
import { sendError } from '@/core/handlerUtils.js'

/**
 * Registers the `POST /graphql` execution endpoint and optionally the `GET /graphql`
 * GraphiQL IDE page on the given HTTP server.
 *
 * The schema is built once at registration time from the provided resource contexts.
 */
export function registerGraphqlRoute(
  server: HttpServer,
  contexts: GraphQLResourceContext[],
  options: GraphQLOptions,
  authStrategy: AuthStrategy
): void {
  if (options.enabled === false) return

  const path = options.path ?? '/graphql'
  const graphiqlEnabled = options.graphiql !== false
  const requireAuth = options.requireAuth === true
  const title = options.title ?? 'Halifax GraphQL'

  const schema = buildGraphQLSchema(contexts)
  const graphiqlHtml = graphiqlEnabled ? generateGraphiQLHtml(path, title) : null

  // ─── POST /graphql — execution endpoint ─────────────────────────────────

  server.registerRoute('POST', path, async (req, res) => {
    try {
      if (requireAuth) await authStrategy.authenticate(req)

      const body = (req.body ?? {}) as GraphQLRequestBody
      const source = body.query ?? ''

      if (!source.trim()) {
        await res.status(400).json({
          errors: [{ message: 'GraphQL request must include a query.' }]
        })
        return
      }

      // Parse and validate before executing so syntax errors surface cleanly.
      let document
      try {
        document = parse(source)
      } catch (syntaxError) {
        await res.status(400).json({
          errors: [
            { message: syntaxError instanceof Error ? syntaxError.message : 'Syntax error.' }
          ]
        })
        return
      }

      const validationErrors = validate(schema, document)
      if (validationErrors.length) {
        await res.status(400).json({ errors: validationErrors.map((e) => ({ message: e.message })) })
        return
      }

      const result = await graphql({
        schema,
        source,
        variableValues: body.variables,
        operationName: body.operationName,
        contextValue: { req }
      })

      res.setHeader?.('Content-Type', 'application/json')
      await res.status(200).json(result)
    } catch (error) {
      await sendError(error, res)
    }
  })

  // ─── GET /graphql — GraphiQL IDE ─────────────────────────────────────────

  if (graphiqlEnabled && graphiqlHtml) {
    server.registerRoute('GET', path, async (req, res) => {
      try {
        if (requireAuth) await authStrategy.authenticate(req)
        res.setHeader?.('Content-Type', 'text/html; charset=utf-8')
        res.send?.(graphiqlHtml)
      } catch (error) {
        await sendError(error, res)
      }
    })
  }
}
