import type { GraphQLOptions, GraphQLRequestBody, GraphQLResourceContext } from './types.js'
import type { AuthStrategy } from '@/auth/strategies/types.js'
import type { HttpServer } from '@/core/types.js'
import { sendError } from '@/core/handlerUtils.js'

/**
 * Registers the `POST /graphql` execution endpoint and optionally the `GET /graphql`
 * GraphiQL IDE page on the given HTTP server.
 *
 * The schema is built lazily on the first request so that the `graphql` peer dependency
 * is only loaded when GraphQL is actually used — not at startup.
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

  type Ready = {
    schema: import('graphql').GraphQLSchema
    graphql: (typeof import('graphql'))['graphql']
    parse: (typeof import('graphql'))['parse']
    validate: (typeof import('graphql'))['validate']
    graphiqlHtml: string | null
  }

  // Promise is created once and cached — subsequent requests reuse the resolved value.
  let ready: Promise<Ready> | null = null

  function getReady(): Promise<Ready> {
    if (!ready) {
      ready = (async (): Promise<Ready> => {
        const [{ graphql, parse, validate }, { buildGraphQLSchema }] = await Promise.all([
          import('graphql'),
          import('./schema.js')
        ])
        const schema = await buildGraphQLSchema(contexts)
        const graphiqlHtml = graphiqlEnabled
          ? (await import('./graphiql.js')).generateGraphiQLHtml(path, title)
          : null
        return { schema, graphql, parse, validate, graphiqlHtml }
      })()
    }
    return ready
  }

  // ─── POST /graphql — execution endpoint ─────────────────────────────────

  server.registerRoute('POST', path, async (req, res) => {
    try {
      if (requireAuth) await authStrategy.authenticate(req)

      const { schema, graphql, parse, validate } = await getReady()
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

  if (graphiqlEnabled) {
    server.registerRoute('GET', path, async (req, res) => {
      try {
        if (requireAuth) await authStrategy.authenticate(req)
        const { graphiqlHtml } = await getReady()
        res.setHeader?.('Content-Type', 'text/html; charset=utf-8')
        res.send?.(graphiqlHtml!)
      } catch (error) {
        await sendError(error, res)
      }
    })
  }
}
