# Auto CRUD

Halifax generates REST endpoints automatically from a `ResourceDefinition`. Define the resource once; the router registers the routes, validates inputs, enforces field-level security, and handles authentication and authorization.

## Resource Definition

```ts
import type { ResourceDefinition } from '@edium/halifax'
import { postRepository } from './repositories/post.js'

export const postResource: ResourceDefinition = {
  name: 'Post',
  routePrefix: 'posts',
  tableName: 'posts', // required for raw SQL operations
  defaultLimit: 50, // applied when the caller omits ?limit=
  maxLimit: 200, // requests above this are silently capped
  fields: [
    { name: 'id', filterable: true, sortable: true },
    { name: 'title', filterable: true, sortable: true, writable: true },
    { name: 'content', writable: true },
    { name: 'published', filterable: true, writable: true },
    { name: 'authorId', filterable: true },
    { name: 'createdAt', filterable: false, sortable: true, selectable: true }
  ],
  relations: [{ name: 'author', includable: true }],
  permissions: {
    allowDeleteMany: false
  },
  requiredPermissions: {
    readMany: ['posts.read'],
    readOne: ['posts.read'],
    create: ['posts.create'],
    updateOne: ['posts.update'],
    deleteOne: ['posts.delete']
  },
  repository: postRepository
}
```

## Generated Routes

Each `permissions` flag enables one route:

| Flag                            | Method   | Path                     |
| ------------------------------- | -------- | ------------------------ |
| `allowReadMany`                 | `GET`    | `../posts`               |
| `allowReadOne`                  | `GET`    | `../posts/:id`           |
| `allowCreate`                   | `POST`   | `../posts`               |
| `allowUpdateOne`                | `PATCH`  | `../posts/:id`           |
| `allowUpdateMany`               | `PATCH`  | `../posts`               |
| `allowUpsertOne`                | `PUT`    | `../posts/:id`           |
| `allowDeleteOne`                | `DELETE` | `../posts/:id`           |
| `allowDeleteMany`               | `DELETE` | `../posts`               |
| `allowReadManyWithQueryBuilder` | `POST`   | `../posts/query-builder` |

All endpoint flags default to `true` — only set them explicitly to `false` to restrict access.

## The `:id` Parameter

`:id` accepts either an **integer** (1–2,147,483,647) or a **UUID** (RFC 4122, any version). The format is detected automatically — nothing to configure. Anything else returns 400.

```
GET /api/v1/posts/42
GET /api/v1/posts/550e8400-e29b-41d4-a716-446655440000
```

## Field Flags

Each entry in `fields` accepts four optional boolean flags. All default to `true` — only set them explicitly to `false` to restrict access.

| Flag         | Effect when `false`                                                   |
| ------------ | --------------------------------------------------------------------- |
| `filterable` | Rejects the field as a query-string filter (`?fieldName=value`) → 400 |
| `sortable`   | Rejects the field in `?order=` and query-builder `orderBy` → 400      |
| `selectable` | Rejects the field in `?fields=` and query-builder `fields` → 400      |
| `writable`   | Silently strips the field from POST / PATCH request bodies            |

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

Set `defaultLimit` and `maxLimit` on the resource:

```ts
{
  defaultLimit: 50,   // used when the caller omits ?limit=
  maxLimit:     200,  // requests above this are silently capped to 200
}
```

Neither is required. Without them, page size is unlimited and fully caller-controlled.

## Query-String Filtering and Pagination

```
GET /api/v1/posts?limit=25&offset=0&order=-createdAt&published=true&fields=id,title
```

| Parameter       | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| `limit`         | Page size. Capped by `maxLimit`; defaults to `defaultLimit` if set.    |
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

Returns 201. Whether the created records are returned depends on the repository's `supportsCreateManyReturn` capability (see [README_REPOSITORIES.md](./README_REPOSITORIES.md)).

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

### Idempotency-Key (POST create)

Pass an `Idempotency-Key` header on POST create requests. The key is forwarded to the repository via `CreateOptions.idempotencyKey` — repositories that support idempotent creation can use it to deduplicate concurrent or retried requests.

```
POST /api/v1/posts
Idempotency-Key: my-client-generated-uuid
```

The router itself does not enforce uniqueness; deduplication is the repository's responsibility.

## Filter Depth Controls

The `?where` / query-builder `children` filter lets callers nest conditions. To prevent abuse, nesting is capped at depth **4** by default. Set `maxFilterDepth` on the resource to override:

```ts
{
  maxFilterDepth: 1 // only one level of children allowed
}
```

Requests that exceed the limit receive **400 VALIDATION_ERROR**.

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
| 415    | `UNSUPPORTED_MEDIA_TYPE` | `UnsupportedMediaTypeError` | Request body is not `application/json`                                                               |
| 422    | `UNPROCESSABLE_ENTITY`   | `UnprocessableEntityError`  | Semantic validation failure — unknown field, invalid filter, sort/select restriction, depth exceeded |
| 500    | `INTERNAL_ERROR`         | `ServerError`               | Repository misconfigured or unhandled internal error                                                 |
| 501    | `NOT_IMPLEMENTED`        | `NotImplementedError`       | Repository does not support this operation                                                           |

When extra context is available (e.g. Prisma error details), a `details` field is included in the error item.
