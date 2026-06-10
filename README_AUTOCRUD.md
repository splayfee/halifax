# Auto CRUD

Halifax generates REST endpoints automatically from a `ResourceDefinition`. Define the resource once; the router registers the routes, validates inputs, enforces field-level security, and handles auth.

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
    allowCreate: true,
    allowReadOne: true,
    allowReadMany: true,
    allowReadManyWithQueryBuilder: true,
    allowUpdateOne: true,
    allowDeleteOne: true
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

| Flag                            | Method   | Path                   |
| ------------------------------- | -------- | ---------------------- |
| `allowReadMany`                 | `GET`    | `/posts`               |
| `allowReadOne`                  | `GET`    | `/posts/:id`           |
| `allowCreate`                   | `POST`   | `/posts`               |
| `allowUpdateOne`                | `PATCH`  | `/posts/:id`           |
| `allowUpdateMany`               | `PATCH`  | `/posts`               |
| `allowUpsertOne`                | `PUT`    | `/posts/:id`           |
| `allowDeleteOne`                | `DELETE` | `/posts/:id`           |
| `allowDeleteMany`               | `DELETE` | `/posts`               |
| `allowReadManyWithQueryBuilder` | `POST`   | `/posts/query-builder` |

All flags default to `false` except `allowReadOne` and `allowReadMany`, which default to `true`.

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

## Error Response Shape

All errors follow the same envelope:

```json
{
  "error": {
    "name": "PayloadError",
    "message": "Field(s) not filterable: role."
  }
}
```

| Status | Name           | Typical cause                              |
| ------ | -------------- | ------------------------------------------ |
| 400    | `PayloadError` | Invalid id, unknown field, flag violation  |
| 401    |                | Missing or invalid auth token              |
| 403    | `HttpError`    | Authenticated but not authorized           |
| 404    | `HttpError`    | Record not found                           |
| 500    | `Error`        | Unhandled repository error                 |
| 501    | `HttpError`    | Operation not supported by this repository |
