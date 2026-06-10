# HTTP Adapters

Halifax's HTTP layer is swappable. Every transport implements the same interface:

```ts
interface HttpServer {
  registerRoute(method: string, path: string, handler: HttpHandler): void
  start(port: number, host?: string): Promise<void> | void
}
```

The current adapter is **Express 5**.

## Express Adapter

### Install

```bash
pnpm add @edium/halifax express
pnpm add -D @types/express
```

### `createExpressCrudRouter`

The simplest way to integrate Halifax with an existing Express app. Returns a standard Express `Router` that you mount wherever you like.

```ts
// src/app.ts
import express from 'express'
import { createExpressCrudRouter } from '@edium/halifax'
import { authStrategy } from './auth.js'
import { postResource } from './resources/post.js'

export function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', createExpressCrudRouter([postResource, authorResource], { authStrategy }))
  return app
}
```

#### Options

| Option                    | Type           | Description                                                                     |
| ------------------------- | -------------- | ------------------------------------------------------------------------------- |
| `authStrategy`            | `AuthStrategy` | Auth strategy applied to every route (default: `AllowAll`)                      |
| `queryBuilderPath`        | `string`       | Path segment for the query-builder route (default: `query-builder`)             |
| `previewQueryBuilderPath` | `string`       | Path for the query-builder preview endpoint (default: `/query-builder/preview`) |

### With Passport

If you are using `PassportJwtStrategy`, initialize Passport before mounting the router:

```ts
import passport from 'passport'

app.use(passport.initialize())
app.use('/api/v1', createExpressCrudRouter([postResource], { authStrategy }))
```

### `ExpressHttpServer` (lower-level)

Use `ExpressHttpServer` when you need to control the Express app lifecycle directly:

```ts
import { ExpressHttpServer } from '@edium/halifax'
import { registerCrudApi } from '@edium/halifax'

const server = new ExpressHttpServer()
registerCrudApi(server, [postResource], { authStrategy })
server.start(3000)
```

## Implementing a Custom HTTP Adapter

Implement `HttpServer` to support any other framework:

```ts
import type { HttpServer, HttpHandler } from '@edium/halifax'
import Fastify from 'fastify'

class FastifyAdapter implements HttpServer {
  private app = Fastify()

  registerRoute(method, path, handler) {
    const fastifyPath = path.replace(/:(\w+)/g, ':$1') // already compatible
    this.app.route({
      method: method as any,
      url: path,
      handler: async (req, reply) => {
        await handler(
          {
            params: req.params as any,
            query: req.query as any,
            body: req.body,
            headers: req.headers as any,
            raw: req.raw
          },
          { status: (s) => ({ json: (b) => reply.code(s).send(b) }) } as any
        )
      }
    })
  }

  async start(port) {
    await this.app.listen({ port })
  }
}
```

Then pass it to `registerCrudApi`:

```ts
import { registerCrudApi } from '@edium/halifax'

const server = new FastifyAdapter()
registerCrudApi(server, [postResource], { authStrategy })
server.start(3000)
```
