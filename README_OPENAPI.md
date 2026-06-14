# OpenAPI Support

Halifax can automatically generate a complete [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) specification from your registered resources — no manual annotation required. For Prisma-backed resources, field types are introspected directly from the DMMF schema. For custom repositories, you can optionally annotate individual fields.

Two routes are added automatically at your mount point:

| Route | Description |
|---|---|
| `GET /openapi.json` | Raw OpenAPI 3.1 spec (JSON) |
| `GET /docs` | Swagger UI — interactive browser-based docs |

---

## Quick start

```ts
import { createExpressCrudRouter } from '@edium/halifax'

app.use(
  '/api/v1',
  createExpressCrudRouter(resources, {
    openapi: {
      title: 'My API',
      version: '1.0.0',
      servers: [{ url: 'https://api.example.com/v1' }]
    }
  })
)
```

Then visit:
- **http://localhost:3000/api/v1/docs** — Swagger UI
- **http://localhost:3000/api/v1/openapi.json** — raw spec

---

## Enabling only in non-production environments

Use the `enabled` flag to gate docs behind an environment check:

```ts
openapi: {
  enabled: process.env.NODE_ENV !== 'production',
  title: 'My API',
  version: '1.0.0'
}
```

When `enabled` is `false` (or the `openapi` key is omitted entirely), no extra routes are registered and the spec generator is never called — zero overhead in production.

### Recommended environment pattern

```ts
const openApiConfig = process.env.ENABLE_DOCS === 'true'
  ? {
      title: 'My API',
      version: '1.0.0',
      servers: [{ url: `${process.env.BASE_URL}/api/v1` }]
    }
  : undefined

app.use('/api/v1', createExpressCrudRouter(resources, {
  openapi: openApiConfig
}))
```

Set `ENABLE_DOCS=true` in `.env.development`, `.env.test`, and `.env.staging`. Leave it unset (or `false`) in production.

---

## All options

```ts
interface OpenApiOptions {
  enabled?: boolean        // default: true when object is present
  title?: string           // default: 'Halifax API'
  version?: string         // default: '1.0.0'
  description?: string     // markdown supported
  servers?: Array<{ url: string; description?: string }>
  envelope?: string | null // mirrors CrudApiOptions.envelope — auto-propagated
  specPath?: string        // default: '/openapi.json'
  docsPath?: string        // default: '/docs'
}
```

### Custom paths

```ts
openapi: {
  specPath: '/spec/openapi.json',
  docsPath: '/api-reference'
}
// → GET /api/v1/spec/openapi.json
// → GET /api/v1/api-reference
```

---

## Type introspection

### Prisma resources (automatic)

When you use `PrismaAdapter` or `createPrismaResources`, Halifax reads the Prisma DMMF and maps types automatically:

| Prisma type | OpenAPI type | Format |
|---|---|---|
| `String` | `string` | — |
| `Int` | `integer` | `int32` |
| `BigInt` | `integer` | `int64` |
| `Float` | `number` | `float` |
| `Decimal` | `number` | `double` |
| `Boolean` | `boolean` | — |
| `DateTime` | `string` | `date-time` |
| `Json` | `object` | — |
| `Bytes` | `string` | `binary` |

No configuration needed. Types flow through automatically.

### Custom / non-Prisma repositories

Add optional `type` and `format` to any `FieldDefinition`:

```ts
const orders: ResourceDefinition = {
  routePrefix: 'orders',
  repository: myCustomRepo,
  fields: [
    { name: 'id',        type: 'integer',  writable: false },
    { name: 'total',     type: 'number',   format: 'double' },
    { name: 'status',    type: 'string' },
    { name: 'paid',      type: 'boolean' },
    { name: 'createdAt', type: 'string',   format: 'date-time', writable: false }
  ]
}
```

Fields without a `type` default to `string`.

---

## Generated endpoints

The spec documents exactly the operations your `permissions` allow. Disabled operations are omitted entirely.

### Collection routes — `/{resource}`

| Method | Permission flag | Summary |
|---|---|---|
| `GET` | `allowReadMany` | List records (paginated, filtered, sorted) |
| `POST` | `allowCreate` | Create one or many records |
| `PATCH` | `allowUpdateMany` | Bulk-update matching records |
| `DELETE` | `allowDeleteMany` | Bulk-delete matching records |

### Item routes — `/{resource}/{id}`

| Method | Permission flag | Summary |
|---|---|---|
| `GET` | `allowReadOne` | Get one record by ID |
| `PATCH` | `allowUpdateOne` | Partially update a record |
| `PUT` | `allowUpsertOne` | Create or replace a record |
| `DELETE` | `allowDeleteOne` | Delete a record |

### Query route — `/{resource}/query`

| Method | Permission flag | Summary |
|---|---|---|
| `POST` | `allowReadManyWithQueryBuilder` | Advanced query builder |

---

## Query string parameters (GET endpoints)

Every list endpoint (`GET /{resource}`) documents the following parameters:

| Parameter | Type | Description |
|---|---|---|
| `limit` | integer | Maximum records to return (capped by `maxLimit`). |
| `offset` | integer | Records to skip for pagination. |
| `fields` | string | Comma-separated field names to include. Enum of available names is shown. |
| `order` | string | Sort expression: `field:asc` or `field:desc`, comma-separated. Sortable fields listed. |
| `include` | string | Comma-separated relation names to eager-load. Enum of available names is shown. |
| _filterable fields_ | varies | One query param per filterable field for simple equality filters. |
| `X-Correlation-ID` | string (header) | Optional. Echoed back in the response header for tracing. |

**Example:** `GET /posts?limit=20&offset=0&published=true&order=createdAt:desc&fields=id,title,createdAt`

> For range, LIKE, IN, or OR conditions, use `POST /{resource}/query` instead.

---

## Request / response shapes

### List response (`GET` and `POST .../query`)

```json
{
  "count": 42,
  "results": [{ "id": 1, "title": "Hello", "published": true }]
}
```

`count` is the total matching rows before pagination. `results` is the current page.

### Create (`POST /{resource}`)

Send a single object or an array:

```json
{ "title": "Hello", "published": false }
```
```json
[{ "title": "Hello" }, { "title": "World" }]
```

Returns the created record(s) with HTTP `201`. Supports the `Idempotency-Key` header.

### Update one (`PATCH /{resource}/{id}`)

Partial update — only the fields present in the body are changed:

```json
{ "published": true }
```

Returns the updated record with HTTP `200`.

### Upsert (`PUT /{resource}/{id}`)

Create or replace a record at the given ID. Always returns HTTP `200`.

### Bulk update (`PATCH /{resource}`)

The body combines `QueryOptions` fields (to select records) with an `update` key (the fields to set):

```json
{
  "where": [{ "field": "status", "comparison": "=", "value": "draft" }],
  "update": { "status": "archived" }
}
```

`where` is **required** (at least one filter) — this prevents accidental full-table updates.

Response: `{ "updated": [<ids>], "results": [<records>] }`

### Bulk delete (`DELETE /{resource}`)

The body is a `QueryOptions` object. `where` is **required**:

```json
{
  "where": [{ "field": "deletedAt", "comparison": "IS NOT NULL" }]
}
```

Response: `{ "deleted": [<ids or records>] }`

### Delete one (`DELETE /{resource}/{id}`)

Response: `{ "deleted": true }` with HTTP `200`.

---

## POST .../query — advanced query builder

The query builder endpoint accepts a `QueryOptions` body for full-featured filtering:

```json
{
  "where": [
    { "field": "published", "comparison": "=", "value": true },
    { "field": "createdAt", "comparison": ">=", "value": "2024-01-01T00:00:00Z" },
    {
      "operator": "OR",
      "children": [
        { "field": "title", "comparison": "CONTAINS", "value": "Halifax" },
        { "field": "title", "comparison": "STARTS WITH", "value": "Hello" }
      ]
    }
  ],
  "orderBy": [{ "field": "createdAt", "direction": "desc" }],
  "limit": 20,
  "offset": 0,
  "fields": ["id", "title", "createdAt"],
  "include": ["author"]
}
```

### Supported comparison operators

| Operator | Description | Value format |
|---|---|---|
| `=` | Equals | scalar |
| `<>` | Not equals | scalar |
| `<` `>` `<=` `>=` | Numeric / date comparison | scalar |
| `IN` | In list | `[val1, val2, ...]` |
| `NOT IN` | Not in list | `[val1, val2, ...]` |
| `BETWEEN` | Inclusive range | `[min, max]` |
| `NOT BETWEEN` | Outside range | `[min, max]` |
| `LIKE` | SQL LIKE (`%` wildcard) | string |
| `NOT LIKE` | SQL NOT LIKE | string |
| `CONTAINS` | Substring match | string |
| `STARTS WITH` | Prefix match | string |
| `ENDS WITH` | Suffix match | string |
| `IS NULL` | Null check | _(omit value)_ |
| `IS NOT NULL` | Not null check | _(omit value)_ |

### AND / OR precedence

Flat `where` arrays use **AND-precedence over OR** (same as SQL). Use `children` groups with an `operator` for explicit parenthesisation:

```json
{
  "where": [
    { "field": "active", "comparison": "=", "value": true },
    {
      "operator": "OR",
      "children": [
        { "field": "role", "comparison": "=", "value": "admin" },
        { "field": "role", "comparison": "=", "value": "moderator" }
      ]
    }
  ]
}
```

Equivalent SQL: `WHERE active = true AND (role = 'admin' OR role = 'moderator')`

---

## Response envelopes

When `envelope` is configured on the router or per-resource, the spec reflects it:

```ts
createExpressCrudRouter(resources, {
  envelope: 'data',
  openapi: { title: 'My API', version: '1.0.0' }
})
```

All success response schemas automatically wrap under the envelope key:

```json
{ "data": { "id": 1, "title": "Hello" } }
```

Per-resource `envelope` takes precedence over the API-wide default (including `null` to opt out).

---

## Error responses

All error responses share a consistent shape:

```json
{
  "errors": [
    { "code": "NOT_FOUND", "message": "Not found." }
  ]
}
```

### HTTP status codes

| Code | Meaning | When raised |
|---|---|---|
| `400` | Bad Request | Invalid ID format, malformed query params or body, invalid filter expressions |
| `401` | Unauthorized | Missing or invalid auth credentials |
| `403` | Forbidden | Valid credentials but insufficient permissions |
| `404` | Not Found | Record with the given ID does not exist |
| `405` | Method Not Allowed | HTTP method not enabled for this resource |
| `406` | Not Acceptable | Client's `Accept` header excludes `application/json` |
| `415` | Unsupported Media Type | Body-carrying request with non-JSON `Content-Type` |
| `422` | Unprocessable Entity | Unknown fields in body, missing required filter, empty update payload |
| `500` | Internal Server Error | Unexpected repository or framework error |
| `501` | Not Implemented | Repository does not support this operation (e.g. upsert, updateMany, deleteMany) |

---

## Security schemes (Authorize button in Swagger UI)

Halifax automatically reads the security scheme from your `authStrategy` and wires it into the spec. The Swagger UI "Authorize" button appears pre-configured — no extra setup needed.

| Strategy | Scheme documented |
|---|---|
| `ApiKeyAuthStrategy` | `apiKey` in header (uses the configured header name) |
| `JwtClaimsAuthStrategy` | `http` bearer JWT |
| `PassportJwtStrategy` | `http` bearer JWT |
| `Auth0JwtStrategy` / `FirebaseJwtStrategy` | `http` bearer JWT |
| `PassportSessionStrategy` | `apiKey` in cookie (`connect.sid`) |
| `AllowAllAuthStrategy` / custom | No security requirement |

### Custom strategy

Implement `openApiScheme()` on your custom strategy and it's picked up automatically:

```ts
class MyHmacStrategy implements AuthStrategy {
  async authenticate(req) { /* ... */ }

  openApiScheme(): SecurityScheme {
    return { type: 'apiKey', in: 'header', name: 'X-Signature' }
  }
}
```

### Override without touching the strategy

Pass `securityScheme` directly in `openapi` options to override whatever the strategy reports:

```ts
openapi: {
  title: 'My API',
  securityScheme: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
}
```

---

## Using the spec programmatically

`generateOpenApiSpec` is exported and can be called standalone — no server needed:

```ts
import { generateOpenApiSpec } from '@edium/halifax'

const spec = generateOpenApiSpec(resources, {
  title: 'My API',
  version: '1.0.0'
})

// Write to disk
import { writeFileSync } from 'fs'
writeFileSync('openapi.json', JSON.stringify(spec, null, 2))

// Or pass to a CI validation tool
import { validate } from '@redocly/openapi-core'
await validate({ document: spec })
```

This is useful for:
- **CI spec validation** — catch breaking changes before deploy
- **Code generation** — pipe into `openapi-typescript`, `@hey-api/openapi-ts`, or `@edium/halifax-codegen`
- **Static hosting** — publish the spec alongside your deployed API

---

## Frequently asked questions

**Do I need to restart the server to update the spec?**
No. The spec is generated once at startup from the registered resource definitions. Restart is only needed when you change resource definitions in code.

**Does it work with Fastify / HyperExpress?**
The `openapi` option is on `CrudApiOptions` which is shared by all HTTP adapters. For non-Express adapters use `registerCrudApi` directly — the spec and docs routes are registered on whatever `HttpServer` adapter you provide.

**Can I add authentication to the docs route?**
The `/docs` and `/openapi.json` routes bypass your `authStrategy` since they're registered after the resource routes without the auth wrapper. To protect them, mount them behind your own middleware before calling `createExpressCrudRouter`.

**Why does the spec use `results` instead of `data` for list responses?**
`results` is the field name in Halifax's internal `ListResult` type. The spec accurately reflects what the API actually returns.

**Can I use this spec for client code generation?**
Yes. Feed `openapi.json` into any OpenAPI generator. Phase 4 of the Halifax roadmap (`@edium/halifax-codegen`) will generate a fully-typed TanStack Query client directly from this spec.
