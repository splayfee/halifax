# HTTP Adapters

Halifax's HTTP layer is swappable. Every transport implements the same interface:

```ts
interface HttpServer {
  registerRoute(method: string, path: string, handler: HttpHandler): void
  start(port: number, host?: string): Promise<void> | void
}
```

Halifax ships **four** first-party adapters. They are interchangeable: every adapter
produces the same routes, status codes, error-body shape (`{ errors: [{ code, message }] }`),
`Allow`/`X-Correlation-ID` headers, content negotiation (406/415), and method-not-allowed
(405) behaviour. Switching frameworks does not require any change to your resource
definitions, auth strategy, or query logic.

| Framework        | Import path                       | Factory                           | Mount style                        |
| ---------------- | --------------------------------- | --------------------------------- | ---------------------------------- |
| Express 4 / 5    | `@edium/halifax/express`          | `createExpressCrudRouter`         | `app.use('/api', router)`          |
| Fastify          | `@edium/halifax/fastify`          | `createFastifyCrudPlugin`         | `app.register(plugin, { prefix })` |
| HyperExpress     | `@edium/halifax/hyper-express`    | `createHyperExpressCrudRouter`    | `app.use('/api', router)`          |
| Ultimate Express | `@edium/halifax/ultimate-express` | `createUltimateExpressCrudRouter` | `app.use('/api', router)`          |

Each adapter is published as its own subpath entry point, so you only ever load the
framework you actually use — the others are optional peer dependencies and are never
imported unless you import their subpath.

> **A note on routing parity.** Express, HyperExpress, and Ultimate Express all use the
> same `:id` named-parameter routing and `app.all` / `app.any` catch-all, so behaviour is
> identical. Fastify uses a radix-tree router (static segments beat parameters) rather than
> registration order; the adapter compensates so all documented CRUD, 404, 400, 405, 406,
> and 415 behaviour matches the others exactly. The only observable difference is for
> contrived paths that collide a static segment with `:id` (e.g. `GET /posts/query`),
> which is not a real-world CRUD scenario.

---

## Express Adapter

Works seamlessly with both **Express 4 and Express 5** — the same code runs unchanged on
either major.

### Install

```bash
# Express 5
pnpm add @edium/halifax express
pnpm add -D @types/express

# …or Express 4 — equally supported
pnpm add @edium/halifax express@4
pnpm add -D @types/express@4
```

### `createExpressCrudRouter`

Returns a standard Express `Router` that you mount wherever you like.

```ts
import express from 'express'
import { createExpressCrudRouter } from '@edium/halifax/express'
import { authStrategy } from './auth.js'
import { postResource } from './resources/post.js'

export function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', createExpressCrudRouter([postResource], { authStrategy }))
  return app
}
```

#### Options

All four factories accept the same options object:

| Option             | Type                                   | Description                                                 |
| ------------------ | -------------------------------------- | ----------------------------------------------------------- |
| `authStrategy`     | `AuthStrategy`                         | Auth strategy applied to every route (default: `AllowAll`)  |
| `tenant`           | `TenantOptions`                        | Multi-tenant isolation config (see README_MULTITENANCY.md)  |
| `queryBuilderPath` | `string`                               | Path segment for the query-builder route (default: `query`) |
| `cache`            | `{ store?, ttlSeconds?, bustHeader? }` | Read-through caching (see README_CACHE.md)                  |

### `ExpressHttpServer` (lower-level)

```ts
import { ExpressHttpServer } from '@edium/halifax/express'
import { registerCrudApi } from '@edium/halifax'

const server = new ExpressHttpServer(app)
registerCrudApi(server, [postResource], { authStrategy })
server.start(3000)
```

---

## Fastify Adapter

Fastify's mounting mechanism is plugins-with-prefixes rather than mountable routers, so
the idiomatic equivalent of `createExpressCrudRouter` is a **plugin**.

### Install

```bash
pnpm add @edium/halifax fastify
```

### `createFastifyCrudPlugin`

```ts
import Fastify from 'fastify'
import { createFastifyCrudPlugin } from '@edium/halifax/fastify'
import { authStrategy } from './auth.js'
import { postResource } from './resources/post.js'

const app = Fastify()
await app.register(createFastifyCrudPlugin([postResource], { authStrategy }), {
  prefix: '/api/v1'
})
await app.listen({ port: 3000 })
```

Fastify parses JSON request bodies automatically — no body-parser registration is needed.
The adapter installs a catch-all content-type parser inside its plugin scope so non-JSON
payloads produce Halifax's structured `415` rather than Fastify's default error page.

### `FastifyHttpServer` (lower-level)

```ts
import Fastify from 'fastify'
import { FastifyHttpServer } from '@edium/halifax/fastify'
import { registerCrudApi } from '@edium/halifax'

const app = Fastify()
registerCrudApi(new FastifyHttpServer(app), [postResource], { authStrategy })
await app.listen({ port: 3000 })
```

---

## HyperExpress Adapter

[HyperExpress](https://github.com/kartikk221/hyper-express) is a high-performance,
Express-flavoured framework built on uWebSockets.js.

### Install

```bash
pnpm add @edium/halifax hyper-express
```

### `createHyperExpressCrudRouter`

```ts
import HyperExpress from 'hyper-express'
import { createHyperExpressCrudRouter } from '@edium/halifax/hyper-express'
import { authStrategy } from './auth.js'
import { postResource } from './resources/post.js'

const server = new HyperExpress.Server()
server.use('/api/v1', createHyperExpressCrudRouter([postResource], { authStrategy }))
await server.listen(3000)
```

No body-parsing middleware is required: the adapter downloads and parses the JSON body for
you (and leaves non-JSON bodies unparsed so the router can return the structured `415`).

### `HyperExpressHttpServer` (lower-level)

```ts
import HyperExpress from 'hyper-express'
import { HyperExpressHttpServer } from '@edium/halifax/hyper-express'
import { registerCrudApi } from '@edium/halifax'

const server = new HyperExpress.Server()
registerCrudApi(new HyperExpressHttpServer(server), [postResource], { authStrategy })
await server.listen(3000)
```

---

## Ultimate Express Adapter

[Ultimate Express](https://github.com/dimdenGD/ultimate-express) is a drop-in
reimplementation of the Express API on top of uWebSockets.js. Usage is identical to the
Express adapter.

### Install

```bash
pnpm add @edium/halifax ultimate-express
```

### `createUltimateExpressCrudRouter`

```ts
import express from 'ultimate-express'
import { createUltimateExpressCrudRouter } from '@edium/halifax/ultimate-express'
import { authStrategy } from './auth.js'
import { postResource } from './resources/post.js'

const app = express()
app.use(express.json())
app.use('/api/v1', createUltimateExpressCrudRouter([postResource], { authStrategy }))
app.listen(3000)
```

### `UltimateExpressHttpServer` (lower-level)

```ts
import express from 'ultimate-express'
import { UltimateExpressHttpServer } from '@edium/halifax/ultimate-express'
import { registerCrudApi } from '@edium/halifax'

const app = express()
registerCrudApi(new UltimateExpressHttpServer(app), [postResource], { authStrategy })
app.listen(3000)
```

> **Note** — `ultimate-express` and `hyper-express` depend on `uWebSockets.js`, which is
> distributed only as a git repository (not on the npm registry). If your package manager
> blocks "exotic" git sub-dependencies (pnpm does by default), allow them — this repo's
> `.npmrc` sets `block-exotic-subdeps=false` for exactly this reason.

---

## With Passport

If you are using `PassportJwtStrategy` with Express or Ultimate Express, initialize
Passport before mounting the router:

```ts
import passport from 'passport'

app.use(passport.initialize())
app.use('/api/v1', createExpressCrudRouter([postResource], { authStrategy }))
```

---

## Implementing a Custom HTTP Adapter

To support any other framework, implement `HttpServer`. The contract is small: map the
framework's request/response onto Halifax's `HttpRequest` / `HttpResponse`, route `'*'` to
the framework's "any method" handler (for 405 fallbacks), and make `start()` listen.

```ts
import type { HttpServer, HttpRouteHandler, HttpMethod } from '@edium/halifax'
import { registerCrudApi } from '@edium/halifax'

class MyAdapter implements HttpServer {
  constructor(private app: MyFramework) {}

  registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler) {
    const run = (req, res) =>
      handler(
        {
          method: req.method,
          params: req.params,
          query: req.query,
          body: req.body,
          headers: req.headers,
          raw: req
        },
        {
          raw: res,
          status(code) {
            res.statusCode = code
            return this
          },
          json(payload) {
            res.json(payload)
          },
          send(payload) {
            res.send(payload)
          },
          setHeader(name, value) {
            res.setHeader(name, value)
          }
        }
      )
    if (method === '*') this.app.any(path, run)
    else this.app[method.toLowerCase()](path, run)
  }

  async start(port: number, host?: string) {
    await this.app.listen(port, host)
  }
}

registerCrudApi(new MyAdapter(app), [postResource], { authStrategy })
```

The four first-party adapters in `src/adapters/http/` are the best reference
implementations — each is a small, self-contained file.

---

## Testing

Every adapter is verified against a single shared **Express-parity contract**
(`tests/helpers/adapterContract.ts`): the identical set of HTTP assertions is run against
all frameworks so "behaves exactly like Express" is enforced by construction.

- **Unit** (`pnpm test:unit`) — runs the contract against each adapter with an in-memory
  repository; no database required.
- **Integration** (`pnpm test:integration`) — runs a Prisma + PostgreSQL HTTP contract
  against each adapter. Requires `DATABASE_URL` in `.env.test`; skipped when unset.
