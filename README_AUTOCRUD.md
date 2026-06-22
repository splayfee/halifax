# Auto CRUD

Halifax generates REST endpoints automatically from a `ResourceDefinition`. Define the resource once; the router registers the routes, validates inputs, enforces field-level security, and handles authentication and authorization.

## Resource Definition

```ts
import type { ResourceDefinition } from '@edium/halifax'
import { postRepository } from './repositories/post.js'

// Permissive + minimal by default. Only `routePrefix`, `repository`, and `fields` are
// required — and `fields` only when the repository can't supply its own schema (see below).
export const postResource: ResourceDefinition = {
  routePrefix: 'posts',
  repository: postRepository,
  fields: [
    { name: 'id' }, // primary key — non-writable automatically
    { name: 'title' },
    { name: 'content' },
    { name: 'published' },
    { name: 'authorId', writable: false }, // the only "exceptions" you need to spell out:
    { name: 'createdAt', writable: false } // FK + server-managed timestamp are read-only
  ]
}
```

> **Why so few fields?** When the repository already knows the model schema — any
> `PrismaAdapter` built with a `model`, and everything from `createPrismaResources` — you can
> omit `fields` entirely; the repository's schema becomes the base and anything you list is
> merged over it **by name** as a sparse override. So you declare a field only to _change_ it
> (e.g. `{ name: 'content', writable: false }`). The bare adapter above (no model) is the path
> for **custom, non-Prisma repositories**, where `fields` is how you declare the API surface.

### Verbose mode — every option, defaults made explicit

Nothing here is required; this is the same resource with every knob turned and annotated, so
you can see exactly what the minimal form above is defaulting to.

```ts
export const postResource: ResourceDefinition = {
  routePrefix: 'posts',
  repository: postRepository,
  name: 'Post', // default: title-cased routePrefix ('posts' → 'Posts')
  fields: [
    // Every flag defaults to `true`; the primary key is non-writable unless opted in.
    { name: 'id', filterable: true, sortable: true, selectable: true, writable: false },
    { name: 'title', filterable: true, sortable: true, selectable: true, writable: true },
    { name: 'content', selectable: true, writable: true },
    { name: 'published', filterable: true, writable: true },
    { name: 'authorId', filterable: true, writable: false },
    { name: 'createdAt', sortable: true, writable: false }
  ],
  relations: [{ name: 'author', includable: true }], // default: includable when listed
  permissions: {
    // Every single-record verb + the query-builder default to `true`; only the bulk writes
    // `allowUpdateMany` and `allowDeleteMany` default to `false` — opt them in here when needed.
    allowDeleteMany: true
  },
  requiredPermissions: {
    readMany: ['posts.read'],
    create: ['posts.create'],
    deleteOne: ['posts.delete']
  },
  defaultLimit: 5000, // default: 5000   (0 = return all rows when ?limit= is omitted)
  maxLimit: 5000, // default: 5000   (0 = no cap)
  cache: { ttlSeconds: 30 } // default: caching off
}
```

## Generated Routes

Each `permissions` flag enables one route:

| Flag                            | Method   | Path             |
| ------------------------------- | -------- | ---------------- |
| `allowReadMany`                 | `GET`    | `../posts`       |
| `allowReadOne`                  | `GET`    | `../posts/:id`   |
| `allowCreate`                   | `POST`   | `../posts`       |
| `allowUpdateOne`                | `PATCH`  | `../posts/:id`   |
| `allowUpdateMany`               | `PATCH`  | `../posts`       |
| `allowUpsertOne`                | `PUT`    | `../posts/:id`   |
| `allowDeleteOne`                | `DELETE` | `../posts/:id`   |
| `allowDeleteMany`               | `DELETE` | `../posts`       |
| `allowReadManyWithQueryBuilder` | `POST`   | `../posts/query` |

All endpoint flags default to `true` **except the bulk writes `allowUpdateMany` and `allowDeleteMany`, which default to `false`** (changed in 3.0.0 — a single bad filter on a mass write can mutate or destroy a whole table). Set a flag to `false` to restrict a single-record verb, or to `true` to opt into a bulk write.

## The `:id` Parameter

`:id` accepts an **integer** (1–2,147,483,647), a **UUID** (RFC 4122, any version), or a **MongoDB ObjectId** (24 hex chars). The format is detected automatically — nothing to configure. Anything else returns 400.

```
GET /api/v1/posts/42
GET /api/v1/posts/550e8400-e29b-41d4-a716-446655440000
GET /api/v1/posts/507f1f77bcf86cd799439011
```

## Field Flags

Each entry in `fields` accepts four optional boolean flags. All default to `true` — only set them explicitly to `false` to restrict access. The lone exception: the **primary key** is non-writable by default (it comes from the URL / database); set `writable: true` on it if you really want clients to supply it.

| Flag         | Effect when `false`                                                   |
| ------------ | --------------------------------------------------------------------- |
| `filterable` | Rejects the field as a query-string filter (`?fieldName=value`) → 422 |
| `sortable`   | Rejects the field in `?order=` and query-builder `orderBy` → 422      |
| `selectable` | Rejects the field in `?fields=` and query-builder `fields` → 422      |
| `writable`   | Silently strips the field from POST / PATCH / PUT request bodies      |

Example — `role` is fully locked down; `createdAt` can be read and sorted but never written or filtered:

```ts
fields: [
  { name: 'id', filterable: true, sortable: true, selectable: true },
  { name: 'email', filterable: true, sortable: true, selectable: true, writable: true },
  { name: 'role', filterable: false, sortable: false, selectable: false, writable: false },
  { name: 'createdAt', filterable: false, sortable: true, selectable: true }
]
```

## Pagination

**By default a list endpoint returns at most 5000 records.** Page size is bounded by generous
defaults — **`defaultLimit: 5000`** (used when the caller omits `?limit=`) and **`maxLimit: 5000`**
(the hard ceiling) — a seatbelt against an accidental unbounded scan of a large table, nothing
more. The response `count` is always the true total matching the query, so a capped page is never
a _silent_ drop — a client can see when `count` exceeds the number of returned rows. Override
either per resource:

```ts
{
  defaultLimit: 25,   // smaller default page for this resource
  maxLimit:     5000, // allow larger pages here
}
```

**Disabling pagination.** Set a limit to `0` to remove that bound. `defaultLimit: 0` returns all
rows when `?limit=` is omitted; `maxLimit: 0` removes the cap. Use both to turn pagination off
entirely (every request returns the full result set) — handy when migrating an app that has
always pulled all rows:

```ts
{ defaultLimit: 0, maxLimit: 0 } // no pagination — return everything
```

## Response Envelope

By default every success response is sent **bare** — a list is `{ count, results }`, a single
record is the object itself, a delete is `{ deleted: true }`. To wrap every success body under a
single key (handy when adopting Halifax behind a client that expects a legacy `{ data: ... }`
shape), set `envelope` — API-wide or per resource:

```ts
// API-wide: every resource's success body is wrapped under "data"
createExpressCrudRouter(resources, { authStrategy, envelope: 'data' })

// Per resource (wins over the API-wide setting):
{ routePrefix: 'posts', repository, envelope: 'data' }
```

The wrap is **uniform** — it nests the entire body, it does not reshape it:

| Endpoint      | Bare (default)       | `envelope: 'data'`             |
| ------------- | -------------------- | ------------------------------ |
| List / query  | `{ count, results }` | `{ data: { count, results } }` |
| Read / create | `{ id, ... }`        | `{ data: { id, ... } }`        |
| Delete one    | `{ deleted: true }`  | `{ data: { deleted: true } }`  |

Notes:

- **Errors are never enveloped** — they always use the `{ errors: [...] }` shape (see below), so
  clients have one stable error contract regardless of the success envelope.
- **Precedence** — an explicit per-resource `envelope` always wins, including `null` or `''`,
  which opts a single resource out of an API-wide envelope. Omit it to inherit the API default.
- `null`, `undefined`, and `''` all mean "no envelope" (an empty key is rejected as meaningless).
- The envelope is applied at the response boundary, after the read-through cache, so cached
  payloads are envelope-agnostic.

## Query-String Filtering and Pagination

```
GET /api/v1/posts?limit=25&offset=0&order=-createdAt&published=true&fields=id,title
```

| Parameter       | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| `limit`         | Page size. Capped by `maxLimit`; defaults to `defaultLimit` (5000).    |
| `offset`        | Number of rows to skip.                                                |
| `order`         | Comma-separated field names. Prefix `-` for descending.                |
| `fields`        | Comma-separated field names to include in the response.                |
| `include`       | Comma-separated relation names to eager-load (e.g. `?include=author`). |
| `<field>=value` | Exact-match filter on any `filterable` field.                          |

Multiple values for a field filter produce an `IN` query:

```
GET /api/v1/posts?authorId=1,2,3
```

## Relation Includes

Declare includable relations in the resource definition, then request them with `?include=`:

```ts
relations: [
  { name: 'author', includable: true },
  { name: 'comments', includable: false } // blocked
]
```

```
GET /api/v1/posts/42?include=author
GET /api/v1/posts?include=author&limit=10
```

## Batch Create

Send an array body to create multiple records in one request:

```ts
POST /
  api /
  v1 /
  posts[({ title: 'First', published: false }, { title: 'Second', published: true })]
```

Returns 201. Whether the created records are returned depends on the repository's `supportsCreateManyReturn` capability (see [README_REPO_ADAPTERS.md](./README_REPO_ADAPTERS.md)).

## HTTP Headers

### Content Negotiation (Accept → 406)

All routes check the `Accept` header. Requests that explicitly exclude `application/json` receive **406 Not Acceptable**. Requests with no `Accept` header, `*/*`, or `application/*` proceed normally.

```
Accept: application/json     ✓
Accept: */*                  ✓
Accept: application/json, text/html;q=0.5  ✓
(no header)                  ✓
Accept: text/html            → 406
```

### Content Type (Content-Type → 415)

Requests with a body (`POST`, `PATCH`, `PUT`, `DELETE`) must use `Content-Type: application/json`. Any other value returns **415 Unsupported Media Type**.

```
Content-Type: application/json          ✓
Content-Type: application/json; utf-8   ✓
(no header, no body)                    ✓
Content-Type: text/plain                → 415
Content-Type: application/x-www-form-urlencoded  → 415
```

### Method Not Allowed (405)

If a resource has at least one method enabled, all other methods on that path return **405 Method Not Allowed** with an `Allow` response header listing the permitted methods.

```
# Resource has allowReadMany + allowCreate only:
GET    /api/v1/posts   → 200
POST   /api/v1/posts   → 201
PUT    /api/v1/posts   → 405  Allow: GET, POST
DELETE /api/v1/posts   → 405  Allow: GET, POST
```

### X-Correlation-ID

If the request includes an `X-Correlation-ID` header, the same value is echoed back in the response. Use this to correlate log entries across services.

```
# Request
X-Correlation-ID: 550e8400-e29b-41d4-a716-446655440000

# Response includes:
X-Correlation-ID: 550e8400-e29b-41d4-a716-446655440000
```

## Filter Depth Controls

The `?where` / query-builder `children` filter lets callers nest conditions. To prevent abuse, nesting is capped at depth **4** by default. Set `maxFilterDepth` on the resource to override:

```ts
{
  maxFilterDepth: 1 // only one level of children allowed
}
```

Requests that exceed the limit receive **422 UNPROCESSABLE_ENTITY**.

## Error Response Shape

All errors follow the same envelope — an `errors` array where each item has a machine-readable `code` and a human-readable `message`:

```json
{
  "errors": [
    {
      "code": "VALIDATION_ERROR",
      "message": "Field(s) not filterable: role."
    }
  ]
}
```

| Status | Code                     | Error class                 | Typical cause                                                                                        |
| ------ | ------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`            | `BadRequestError`           | Malformed `:id` — not an integer (1–2147483647) or UUID                                              |
| 401    | `UNAUTHORIZED`           | `AuthenticationError`       | Missing or invalid auth token                                                                        |
| 403    | `FORBIDDEN`              | `AuthorizationError`        | Authenticated but lacks required permission                                                          |
| 404    | `NOT_FOUND`              | `NotFoundError`             | Record not found                                                                                     |
| 405    | `METHOD_NOT_ALLOWED`     | `MethodNotAllowedError`     | HTTP method not enabled for this resource                                                            |
| 406    | `NOT_ACCEPTABLE`         | `NotAcceptableError`        | `Accept` header excludes `application/json`                                                          |
| 409    | `CONFLICT`               | `ConflictError`             | Write rejected due to a unique constraint violation                                                  |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | `UnsupportedMediaTypeError` | Request body is not `application/json`                                                               |
| 422    | `UNPROCESSABLE_ENTITY`   | `UnprocessableEntityError`  | Semantic validation failure — unknown field, invalid filter, sort/select restriction, depth exceeded |
| 500    | `INTERNAL_ERROR`         | `ServerError`               | Repository misconfigured or unhandled internal error                                                 |
| 501    | `NOT_IMPLEMENTED`        | `NotImplementedError`       | Repository does not support this operation                                                           |

When extra context is available (e.g. Prisma error details), a `details` field is included in the error item.
