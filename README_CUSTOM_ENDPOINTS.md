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

### `api.addCustomEndpoint(method, path, roles, handler, openapi?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | HTTP verb |
| `path` | `string` | Route path, e.g. `'/reports/summary'` or `'/orders/:id/invoice'`. Path params are available via `req.params`. |
| `roles` | `string[]` | Required roles or permission slugs. **OR logic** — any single match in `auth.roles` or `auth.permissions` grants access. Pass `[]` to allow any authenticated caller. |
| `handler` | `CustomEndpointHandler` | Your business logic (see below). |
| `openapi` | `CustomEndpointOpenApi \| undefined` | Optional OpenAPI 3.1 metadata merged into the live spec. |

Returns `this` for chaining.

**Throws `ServerError`** when `method + path` is already registered — either by Halifax's own CRUD routes or by a prior `addCustomEndpoint` call. This prevents silent route shadowing.

### `CustomEndpointHandler`

```ts
type CustomEndpointHandler = (
  req: HttpRequest,
  res: HttpResponse,
  ctx: CustomEndpointContext
) => Promise<void> | void

interface CustomEndpointContext {
  auth: AuthContext   // resolved by the configured auth strategy before your handler is called
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
| **Authentication** | `authStrategy.authenticate(req)` runs before your handler. Unauthenticated requests are rejected with the strategy's error (typically 401). |
| **Role enforcement** | If `roles` is non-empty, any caller whose `auth.roles` or `auth.permissions` contains at least one of the listed values is allowed; all others receive 403. |
| **Error serialization** | Throw any Halifax error class (`NotFoundError`, `BadRequestError`, `AuthorizationError`, `UnprocessableEntityError`, …) and Halifax serializes it as `{ errors: [{ code, message }] }` with the correct status code. Unhandled exceptions become 500. |
| **Content-Type negotiation** | `POST`/`PUT`/`PATCH`/`DELETE` requests with a non-JSON body receive 415. Requests with an `Accept` header that excludes `application/json` receive 406. |
| **`X-Correlation-ID` echo** | When the request carries an `X-Correlation-ID` header, the same value is echoed back on the response. |

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
