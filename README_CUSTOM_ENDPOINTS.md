# Halifax — Custom Endpoints

Halifax auto-generates standard CRUD routes from your resource definitions, but real applications always have endpoints that don't fit that mold: aggregate queries (`GROUP BY` / `HAVING`), complex joins, business-action routes (`POST /orders/:id/fulfill`), or anything that calls an external service. Custom endpoints let you register those routes while inheriting the same auth pipeline, error handling, and OpenAPI documentation that Halifax provides for its generated routes.

## When to use custom endpoints

Use `addCustomEndpoint` when:

- The response requires an aggregate (`GROUP BY`, `SUM`, `COUNT`) or a `HAVING` clause.
- The query spans multiple tables in a way your ORM can't express through a single resource.
- The route performs a **business action** rather than a plain CRUD operation (approve, fulfill, archive, trigger-email, …).
- You need a custom response shape that doesn't map to a single model.

Use standard CRUD (resource definitions) when you're doing plain list / read / create / update / delete on a single table — Halifax handles those automatically.

---

## Quick example

```ts
import express, { Router } from 'express'
import {
  ExpressHttpServer,
  registerCrudApi,
  PrismaAdapter,
  ApiKeyAuthStrategy,
  NotFoundError,
  type ResourceDefinition
} from '@edium/halifax'

const app = express()
app.use(express.json())

// Use registerCrudApi (not createExpressCrudRouter) to get the HalifaxApi instance back.
const router = Router()
const api = registerCrudApi(
  new ExpressHttpServer(router),
  [ordersResource],
  { authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY!) }
)
app.use('/api', router)

// Register a custom endpoint anywhere — at startup, or lazily in another module.
api.addCustomEndpoint(
  'POST',
  '/orders/:id/fulfill',
  ['fulfillment'],                    // caller must have the 'fulfillment' role/permission
  async (req, res, ctx) => {
    const order = await fulfillOrder(req.params['id']!, ctx.auth.userId)
    if (!order) throw new NotFoundError('Order not found.')
    await res.status(200).json({ orderId: order.id, status: order.status })
  },
  { summary: 'Fulfill an order', tags: ['Orders'] }
)

app.listen(3000)
```

---

## Setup: `registerCrudApi` vs `createExpressCrudRouter`

`createExpressCrudRouter` is a convenience wrapper that returns an Express `Router`. To also get the `HalifaxApi` instance you need for custom endpoints, use `registerCrudApi` directly with an explicit server adapter:

```ts
// Before — convenience wrapper, no HalifaxApi returned
const router = createExpressCrudRouter(resources, options)
app.use('/api', router)

// After — use registerCrudApi, get HalifaxApi back
import { Router } from 'express'
import { ExpressHttpServer, registerCrudApi } from '@edium/halifax'

const router = Router()
const api = registerCrudApi(new ExpressHttpServer(router), resources, options)
app.use('/api', router)

api.addCustomEndpoint(/* ... */)
```

The same pattern works for every supported framework:

```ts
// Fastify
import { FastifyHttpServer } from '@edium/halifax'

const fastify = Fastify()
const api = registerCrudApi(new FastifyHttpServer(fastify), resources, options)
api.addCustomEndpoint(/* ... */)
```

---

## API reference

`addCustomEndpoint` has two call forms. Use whichever reads better:

```ts
// Positional — roles + optional OpenAPI metadata
api.addCustomEndpoint(method, path, roles, handler, openapi?)

// Options bag — unlocks auth toggles, per-endpoint authorize, and content negotiation
api.addCustomEndpoint(method, path, options, handler)
```

### Positional form — `api.addCustomEndpoint(method, path, roles, handler, openapi?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | HTTP verb |
| `path` | `string` | Route path, e.g. `'/reports/summary'` or `'/orders/:id/invoice'`. Path params are available via `req.params`. |
| `roles` | `string[] \| null` | Required roles or permission slugs. **OR logic** — any single match in `auth.roles` or `auth.permissions` grants access. Pass `[]` to allow any authenticated caller, or **`null` to make the endpoint public** (authentication is skipped — see [Public endpoints](#public-unauthenticated-endpoints)). |
| `handler` | `CustomEndpointHandler` | Your business logic (see below). |
| `openapi` | `CustomEndpointOpenApi \| undefined` | Optional OpenAPI 3.1 metadata merged into the live spec. |

Returns `this` for chaining.

**Throws `ServerError`** when `method + path` is already registered — either by Halifax's own CRUD routes or by a prior `addCustomEndpoint` call. This prevents silent route shadowing.

### Options-bag form — `api.addCustomEndpoint(method, path, options, handler)`

```ts
interface CustomEndpointOptions {
  /** Roles/permissions (OR logic). [] / omitted → any authenticated caller. null → public. */
  roles?: string[] | null
  /** Public-endpoint toggle. `false` skips authentication (same as `roles: null`). Default true. */
  auth?: boolean
  /** One-off authorization predicate. When set it is the SOLE gate (overrides roles + authorizeCustom). */
  authorize?: (ctx: { auth: AuthContext; req: HttpRequest }) => boolean | Promise<boolean>
  /** Route role-gating through AuthStrategy.authorizeCustom when available. Default true. */
  useStrategyAuthorize?: boolean
  /** Accepted request Content-Types (e.g. ['multipart/form-data']). Default ['application/json']. */
  consumes?: string[]
  /** Produced response types negotiated against Accept (e.g. ['application/pdf']). Default ['application/json']. */
  produces?: string[]
  /** OpenAPI 3.1 metadata merged into the live spec. */
  openapi?: CustomEndpointOpenApi
}
```

Every field is optional, and the defaults reproduce the positional call exactly — so
`addCustomEndpoint('GET', '/x', [], handler)` and `addCustomEndpoint('GET', '/x', { roles: [] }, handler)`
are equivalent.

### `CustomEndpointHandler`

```ts
type CustomEndpointHandler = (
  req: HttpRequest,
  res: HttpResponse,
  ctx: CustomEndpointContext
) => Promise<void> | void

interface CustomEndpointContext {
  // Resolved by the configured auth strategy before your handler is called.
  // For a PUBLIC endpoint this is `{ isAuthenticated: false }` — the handler owns any checks.
  auth: AuthContext
}
```

### `CustomEndpointOpenApi`

All fields are optional. When provided, the operation is merged into the live `/openapi.json` spec immediately after registration.

```ts
interface CustomEndpointOpenApi {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: OpenApiParameter[]
  requestBody?: { required: boolean; content: { 'application/json': { schema: JsonSchema } } }
  responses?: Record<string, { description: string; content?: { 'application/json': { schema: JsonSchema } } }>
  // responses defaults to { '200': { description: 'OK' } } when omitted
}
```

---

## What you get for free

Every custom endpoint automatically receives the same middleware stack Halifax applies to its generated CRUD routes:

| Feature | Behaviour |
|---------|-----------|
| **Authentication** | `authStrategy.authenticate(req)` runs before your handler. Unauthenticated requests are rejected with the strategy's error (typically 401). Skipped entirely for [public endpoints](#public-unauthenticated-endpoints) (`roles: null` / `auth: false`). |
| **Authorization** | When `roles` is non-empty, the caller must hold at least one (OR logic). A strategy that implements [`authorizeCustom`](#hierarchical-authorization-with-authorizecustom) gets to apply its own model (e.g. a role hierarchy) instead of the flat match; a per-endpoint [`authorize` predicate](#per-endpoint-authorize-predicate) overrides both. Denied callers receive 403. |
| **Error serialization** | Throw any Halifax error class (`NotFoundError`, `BadRequestError`, `AuthorizationError`, `UnprocessableEntityError`, …) and Halifax serializes it as `{ errors: [{ code, message }] }` with the correct status code. Unhandled exceptions become 500. |
| **Content-Type negotiation** | By default `POST`/`PUT`/`PATCH`/`DELETE` requests with a non-JSON body receive 415, and a request whose `Accept` excludes `application/json` receives 406. Override per endpoint with [`consumes` / `produces`](#content-negotiation-uploads--binary-responses). |
| **`X-Correlation-ID` echo** | When the request carries an `X-Correlation-ID` header, the same value is echoed back on the response. |

---

## Public (unauthenticated) endpoints

Some routes must be reachable with no session or token — health checks, `login`, account
activation, password reset, and inbound webhooks. Pass **`null`** as `roles` (positional form) or
**`{ auth: false }`** (options bag) and Halifax skips `authStrategy.authenticate` entirely:

```ts
// Positional — null roles = public
api.addCustomEndpoint('GET', '/health', null, async (_req, res) => {
  await res.status(200).json({ status: 'ok' })
})

// Options bag — auth: false is equivalent
api.addCustomEndpoint('POST', '/login', { auth: false }, async (req, res) => {
  const session = await authenticateUser(req.body)          // your own login logic
  if (!session) throw new BadRequestError('Invalid credentials.')
  await res.status(200).json({ ok: true })
})
```

The handler still gets error serialization, content negotiation, and `X-Correlation-ID` echo — it
just isn't authenticated, so `ctx.auth` is `{ isAuthenticated: false }`. In the OpenAPI spec a
public operation is marked `security: []`, so Swagger UI renders no lock icon for it.

> Authentication is the only thing skipped. If your public handler needs request validation or rate
> limiting, do it inside the handler (or with framework middleware mounted on the route) — Halifax
> does not run those for you.

---

## Hierarchical authorization with `authorizeCustom`

By default, a non-empty `roles` array is checked with a **flat OR-match**: the caller is allowed if
`auth.roles` or `auth.permissions` contains any listed value. That is perfect for slug-style
permissions (`['reports:read']`) but not for a **role hierarchy** where "admin" should implicitly
satisfy a "manager"-gated route.

Implement the optional **`authorizeCustom`** method on your `AuthStrategy` — the custom-endpoint
counterpart of `authorize` — and Halifax calls it (instead of the flat match) for every custom
endpoint that doesn't declare its own `authorize` predicate. This lets custom endpoints reuse the
exact authorization model you already apply to auto-CRUD via `requiredPermissions`:

```ts
class SessionAuthStrategy implements AuthStrategy {
  authenticate(req) { /* … resolve { roles, permissions, claims: { roleValue } } … */ }

  // CRUD routes — value-threshold check (lower value = more privileged)
  authorize({ auth, requiredPermissions }) {
    return passesThreshold(auth, requiredPermissions)
  }

  // Custom endpoints — SAME rule, keyed on the route instead of a CRUD action
  authorizeCustom({ auth, requiredPermissions }) {
    return passesThreshold(auth, requiredPermissions)
  }
}
```

```ts
// Now a Manager-gated custom endpoint is satisfied by Manager AND any higher role:
api.addCustomEndpoint('POST', '/invite', ['role:3'], inviteHandler)   // role:3 = Manager threshold
```

`authorizeCustom` receives `{ auth, method, path, requiredPermissions, req }` (the `roles` array you
passed becomes `requiredPermissions`). Strategies that don't implement it fall back to the flat
OR-match — so this is fully backward compatible. To force the flat match on a single endpoint even
when the strategy implements `authorizeCustom`, pass `useStrategyAuthorize: false`.

---

## Per-endpoint `authorize` predicate

For one-off, resource-specific rules (typically ownership checks) pass an `authorize` callback in
the options bag. When present it is the **sole** authorization gate — it overrides both `roles`
matching and `authorizeCustom`:

```ts
api.addCustomEndpoint(
  'GET',
  '/orders/:id',
  {
    authorize: async ({ auth, req }) => {
      const order = await db.order.findUnique({ where: { id: Number(req.params.id) } })
      return order?.ownerId === auth.userId      // false → 403
    }
  },
  async (req, res) => {
    const order = await db.order.findUnique({ where: { id: Number(req.params.id) } })
    await res.status(200).json(order)
  }
)
```

The endpoint is still authenticated first (unless it is also public); the predicate runs only for an
authenticated caller and decides access. Return `false` (or reject) to deny with 403.

---

## Content negotiation: uploads & binary responses

Custom endpoints default to JSON in and JSON out, but real apps need file uploads and binary
downloads. The options bag exposes two arrays:

- **`consumes`** — request `Content-Type`s the route accepts (matched against `Content-Type`).
- **`produces`** — response types the route can return (negotiated against `Accept`).

Both default to `['application/json']`, preserving the standard 415/406 behaviour.

```ts
// File upload — accept multipart bodies (parse with multer/busboy on req.raw or app middleware)
api.addCustomEndpoint(
  'PATCH',
  '/companies/:id/logo',
  { roles: ['admin'], consumes: ['multipart/form-data'] },
  async (req, res) => {
    const url = await uploadLogoFromRequest(req.raw)        // your multipart handling
    await res.status(200).json({ logoUrl: url })
  }
)

// Binary response — stream a PDF
api.addCustomEndpoint(
  'POST',
  '/reports/scans/:id',
  { roles: ['viewer', 'admin'], produces: ['application/pdf'] },
  async (req, res) => {
    const pdf = await renderScanReport(req.params.id)       // a Buffer
    res.setHeader?.('Content-Type', 'application/pdf')
    res.raw.end(pdf)                                        // stream via the raw framework response
  }
)
```

Notes:

- A `'*/*'` entry in `consumes` accepts **any** request body; a media-type family wildcard in the
  request's `Accept` (e.g. `application/*`) is honoured against `produces`.
- Halifax does **not** parse multipart bodies for you — it just stops rejecting them. Parse via
  `req.raw` (busboy) or mount your framework's upload middleware on the path before Halifax.
- For responses, write through `res.raw` (the underlying Express/Fastify/… response) so you control
  streaming and headers.

---

## Multiple credentials with `CompositeAuthStrategy`

When a single route must be reachable by **more than one** kind of credential — e.g. an interactive
**session** *or* a programmatic **API key** — combine strategies with `CompositeAuthStrategy`. It
tries each in order and adopts the first that authenticates the request:

```ts
import { CompositeAuthStrategy, ApiKeyAuthStrategy, PassportSessionStrategy } from '@edium/halifax'

const authStrategy = new CompositeAuthStrategy([
  // API-key callers carry their scopes as permissions → usable as custom-endpoint roles
  new ApiKeyAuthStrategy(process.env.API_KEY!, 'x-api-key', ['devices:read']),
  new PassportSessionStrategy()
])

const api = registerCrudApi(server, resources, { authStrategy })

// Reachable by a session user OR an API key holding the 'devices:read' scope
api.addCustomEndpoint('GET', '/devices', ['devices:read'], listDevicesHandler)
```

`authorize`, `authorizeCustom`, and the OpenAPI security scheme are all delegated to whichever member
strategy actually authenticated the request, so each credential keeps its own authorization rules.

---

## OpenAPI integration

When the API was configured with `openapi: { enabled: true }`, the live spec is a mutable object serialized on each request to `/openapi.json`. Custom endpoints appear in the spec and Swagger UI the moment they are registered — there is no restart required.

```ts
api.addCustomEndpoint(
  'GET',
  '/reports/sales-summary',
  ['analyst'],
  handler,
  {
    summary: 'Sales summary by category',
    description: 'Aggregates revenue and count per product category. Use ?minTotal to filter.',
    tags: ['Reports'],
    parameters: [
      {
        name: 'minTotal',
        in: 'query',
        description: 'Minimum total revenue threshold (HAVING clause).',
        schema: { type: 'number' }
      }
    ],
    responses: {
      '200': {
        description: 'Array of category summaries',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  category: { type: 'string' },
                  count:    { type: 'integer' },
                  total:    { type: 'number' }
                }
              }
            }
          }
        }
      }
    }
  }
)
```

If you omit the `openapi` argument entirely, the endpoint is registered and works normally — it just won't appear in the spec.

---

## Duplicate detection

`addCustomEndpoint` throws `ServerError` when `method + path` is already taken. This covers both generated CRUD routes and previously registered custom endpoints:

```ts
// registerCrudApi registers GET /products, POST /products, GET /products/:id, etc.
const api = registerCrudApi(server, [productsResource], options)

api.addCustomEndpoint('GET', '/products', [], handler) // ✗ throws — conflicts with CRUD list route
api.addCustomEndpoint('GET', '/products/export', [], handler) // ✓ fine — different path
api.addCustomEndpoint('GET', '/products/export', [], handler) // ✗ throws — registered above
```

---

## Examples

### 1. Simple computed GET

```ts
api.addCustomEndpoint(
  'GET',
  '/status',
  [],
  async (_req, res) => {
    await res.status(200).json({
      version: process.env.npm_package_version,
      uptime: process.uptime()
    })
  },
  { summary: 'Service health and version' }
)
```

### 2. Role-protected business action

```ts
api.addCustomEndpoint(
  'POST',
  '/orders/:id/approve',
  ['finance', 'admin'],             // finance OR admin can approve
  async (req, res, ctx) => {
    const orderId = req.params['id']!
    const order = await orderService.approve(orderId, { approvedBy: ctx.auth.userId })
    if (!order) throw new NotFoundError(`Order ${orderId} not found.`)
    await res.status(200).json({ orderId: order.id, status: order.status })
  },
  {
    summary: 'Approve a pending order',
    tags: ['Orders'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]
  }
)
```

### 3. GROUP BY + HAVING aggregate

The canonical use case: a revenue report that can't be expressed as a standard CRUD list because it requires aggregate filtering.

```ts
// Prisma groupBy with HAVING — requires direct client access, not a Halifax repository
api.addCustomEndpoint(
  'GET',
  '/reports/sales-summary',
  ['analyst'],
  async (req, res) => {
    const minTotal = Number(req.query['minTotal'] ?? 0)

    const rows = await prisma.saleRecord.groupBy({
      by: ['category'],
      _count: { id: true },
      _sum:   { amount: true },
      having: { amount: { _sum: { gte: minTotal } } },
      orderBy: { _sum: { amount: 'desc' } }
    })

    await res.status(200).json(
      rows.map(r => ({
        category: r.category,
        count:    r._count.id,
        total:    r._sum.amount
      }))
    )
  },
  {
    summary: 'Sales totals grouped by product category',
    tags: ['Reports'],
    parameters: [
      {
        name: 'minTotal',
        in: 'query',
        description: 'Only return categories whose total revenue meets this threshold.',
        schema: { type: 'number', default: 0 }
      }
    ]
  }
)
```

### 4. Complex join returning a custom shape

When a single model can't represent the response, query directly and shape the output yourself:

```ts
api.addCustomEndpoint(
  'GET',
  '/orders/:id/invoice',
  ['billing', 'admin'],
  async (req, res) => {
    const orderId = Number(req.params['id'])
    const invoice = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        lines: { include: { product: { select: { name: true, sku: true } } } },
        customer: { select: { name: true, email: true, taxId: true } }
      }
    })
    if (!invoice) throw new NotFoundError(`Order ${orderId} not found.`)

    await res.status(200).json({
      orderId:    invoice.id,
      issuedAt:   new Date().toISOString(),
      customer:   invoice.customer,
      lineItems:  invoice.lines.map(l => ({
        sku:      l.product.sku,
        name:     l.product.name,
        qty:      l.quantity,
        subtotal: l.quantity * l.unitPrice
      })),
      total: invoice.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0)
    })
  },
  {
    summary: 'Generate a formatted invoice for an order',
    tags: ['Billing'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }]
  }
)
```

### 5. Custom POST with validation

```ts
import { BadRequestError, UnprocessableEntityError } from '@edium/halifax'

api.addCustomEndpoint(
  'POST',
  '/notifications/send',
  ['admin'],
  async (req, res) => {
    const body = req.body as Record<string, unknown>
    if (!body['recipientId'] || !body['message']) {
      throw new BadRequestError('recipientId and message are required.')
    }
    if (typeof body['message'] !== 'string' || body['message'].length > 500) {
      throw new UnprocessableEntityError('message must be a string under 500 characters.')
    }

    await notificationService.send({
      recipientId: String(body['recipientId']),
      message:     body['message']
    })

    await res.status(202).json({ queued: true })
  },
  {
    summary: 'Send a push notification to a user',
    tags: ['Notifications'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['recipientId', 'message'],
            properties: {
              recipientId: { type: 'string' },
              message:     { type: 'string', description: 'Max 500 characters.' }
            }
          }
        }
      }
    },
    responses: {
      '202': { description: 'Notification queued for delivery.' },
      '400': { description: 'Missing required fields.' },
      '422': { description: 'Validation error.' }
    }
  }
)
```

### 6. Chaining multiple endpoints

`addCustomEndpoint` returns `this`, so you can chain registrations:

```ts
const api = registerCrudApi(server, resources, options)

api
  .addCustomEndpoint('GET',  '/reports/revenue',    ['analyst'], revenueHandler,   { summary: 'Revenue report'   })
  .addCustomEndpoint('GET',  '/reports/churn',      ['analyst'], churnHandler,     { summary: 'Churn report'     })
  .addCustomEndpoint('POST', '/admin/reindex',      ['admin'],   reindexHandler,   { summary: 'Trigger reindex'  })
  .addCustomEndpoint('POST', '/admin/clear-cache',  ['admin'],   clearCacheHandler, { summary: 'Flush all caches' })
```

---

## Disabling auto-CRUD and rolling fully custom routes

You don't have to use Halifax's generated routes at all. If a resource needs completely custom endpoints, disable every auto-CRUD permission and implement the routes yourself via `addCustomEndpoint`. You still get Halifax's auth, error handling, and OpenAPI for free.

### Option A — disable all CRUD on a resource

Pass the resource to `registerCrudApi` with every permission turned off. The resource schema still feeds the OpenAPI component definitions (useful for `$ref` reuse), but no CRUD routes are registered for it:

```ts
const ordersResource: ResourceDefinition = {
  routePrefix: 'orders',
  repository: new PrismaAdapter({ delegate: prisma.order }),
  fields: [
    { name: 'id' },
    { name: 'status', writable: true },
    { name: 'customerId' },
    { name: 'total' },
    { name: 'createdAt' }
  ],
  permissions: {
    allowCreate:                    false,
    allowReadMany:                  false,
    allowReadOne:                   false,
    allowUpdateOne:                 false,
    allowUpdateMany:                false,
    allowUpsertOne:                 false,
    allowDeleteOne:                 false,
    allowDeleteMany:                false,
    allowReadManyWithQueryBuilder:  false
  }
}

const api = registerCrudApi(server, [ordersResource], {
  authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY!),
  openapi: { enabled: true, title: 'Orders API' }
})

// Now implement every route yourself
api
  .addCustomEndpoint(
    'GET',
    '/orders',
    ['viewer', 'admin'],
    async (req, res, ctx) => {
      const orders = await fetchOrdersForCustomer(ctx.auth.userId, req.query)
      await res.status(200).json(orders)
    },
    { summary: 'List orders for the authenticated customer', tags: ['Orders'] }
  )
  .addCustomEndpoint(
    'GET',
    '/orders/:id',
    ['viewer', 'admin'],
    async (req, res, ctx) => {
      const order = await fetchOrderWithLineItems(req.params['id']!, ctx.auth.userId)
      if (!order) throw new NotFoundError('Order not found.')
      await res.status(200).json(order)
    },
    { summary: 'Get a single order with line items', tags: ['Orders'] }
  )
  .addCustomEndpoint(
    'POST',
    '/orders',
    ['customer', 'admin'],
    async (req, res, ctx) => {
      const order = await createOrder(req.body, ctx.auth.userId)
      await res.status(201).json(order)
    },
    { summary: 'Place a new order', tags: ['Orders'] }
  )
  .addCustomEndpoint(
    'POST',
    '/orders/:id/cancel',
    ['customer', 'admin'],
    async (req, res, ctx) => {
      const order = await cancelOrder(req.params['id']!, ctx.auth.userId)
      if (!order) throw new NotFoundError('Order not found.')
      await res.status(200).json({ orderId: order.id, status: order.status })
    },
    { summary: 'Cancel an order', tags: ['Orders'] }
  )
```

### Option B — no resources at all

When you don't need any auto-CRUD at all, pass an empty resource array and build everything with custom endpoints:

```ts
const api = registerCrudApi(server, [], {
  authStrategy: new JwtClaimsAuthStrategy(jwtConfig),
  openapi: { enabled: true, title: 'My Bespoke API' }
})

api
  .addCustomEndpoint('GET',    '/v1/profile',         [], profileHandler,    { summary: 'Get current user profile' })
  .addCustomEndpoint('PATCH',  '/v1/profile',         [], updateProfileHandler, { summary: 'Update profile' })
  .addCustomEndpoint('GET',    '/v1/dashboard',       [], dashboardHandler,  { summary: 'Dashboard summary data' })
  .addCustomEndpoint('POST',   '/v1/password/reset',  [], resetPwdHandler,   { summary: 'Request a password reset' })
```

This is the "full escape hatch" — Halifax acts purely as an auth + error-handling + OpenAPI scaffolding layer, and you own 100% of the route logic.

### Mixing auto-CRUD and custom routes

The most common pattern is to use auto-CRUD for the 70% of resources that are pure CRUD, and `addCustomEndpoint` for the 30% that need business logic. No special configuration is needed — just register your custom endpoints after `registerCrudApi` returns:

```ts
const api = registerCrudApi(server, [
  postsResource,    // pure CRUD — Halifax handles everything
  usersResource,    // pure CRUD
  tagsResource      // pure CRUD
], options)

// Only the business-logic endpoints need addCustomEndpoint
api
  .addCustomEndpoint('POST', '/posts/:id/publish',  ['editor'], publishHandler,  { tags: ['Posts']  })
  .addCustomEndpoint('GET',  '/reports/engagement', ['analyst'], engagementHandler, { tags: ['Reports'] })
```

---

## Error handling reference

Throw any Halifax error class inside a handler to get a structured JSON response with the right HTTP status code. The response shape is always `{ errors: [{ code, message }] }`.

| Class | Status | `code` |
|-------|--------|--------|
| `BadRequestError` | 400 | `BAD_REQUEST` |
| `AuthenticationError` | 401 | `UNAUTHORIZED` |
| `AuthorizationError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `UnprocessableEntityError` | 422 | `UNPROCESSABLE_ENTITY` |
| `ServerError` | 500 | `INTERNAL_ERROR` |

```ts
import { NotFoundError, BadRequestError } from '@edium/halifax'

api.addCustomEndpoint('GET', '/users/:id/profile', [], async (req, res) => {
  const user = await db.findUser(req.params['id']!)
  if (!user) throw new NotFoundError('User not found.')
  if (user.suspended) throw new BadRequestError('Account is suspended.')
  await res.status(200).json(user)
})
```

Unhandled (non-Halifax) errors are caught and returned as `500 INTERNAL_ERROR` — the original error is not leaked to the client.
