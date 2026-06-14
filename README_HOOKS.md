# Halifax — Lifecycle Hooks

Hooks let you inject custom logic **before or after any CRUD operation** without writing a custom repository or HTTP middleware. They are defined per-resource under the `hooks` key on `ResourceDefinition`.

## Quick example

```ts
import {
  createExpressCrudRouter,
  PrismaAdapter,
  AuthorizationError,
  type ResourceDefinition
} from '@edium/halifax'

const posts: ResourceDefinition = {
  routePrefix: 'posts',
  repository: new PrismaAdapter({ delegate: prisma.post }),
  hooks: {
    // Stamp createdBy / updatedBy from the authenticated user
    beforeCreate:    (data, { auth }) => ({ ...data, createdBy: auth.userId }),
    beforeUpdateOne: (id, data, { auth }) => ({ ...data, updatedBy: auth.userId }),

    // Emit a domain event after every new post is saved
    afterCreate: async (result) => { await events.emit('post.created', result) },

    // Block callers from reading soft-deleted posts (belt-and-suspenders on top of auth)
    afterReadOne: (result) => {
      if (result.deletedAt) throw new AuthorizationError('Not found.')
      return result
    }
  }
}
```

---

## How hooks work

### Before hooks

Called **before the database operation**. They receive the incoming data and can:

| Return | Effect |
|---|---|
| A **modified copy** of the data | The modified value is used instead of the original. |
| `void` / `undefined` | The original value is used unchanged. |
| **Throw any `Error`** | The operation is aborted and Halifax sends the appropriate HTTP error response. Use Halifax error classes (`BadRequestError`, `AuthorizationError`, `UnprocessableEntityError`, …) for precise status codes. |

### After hooks

Called **after the database operation, before the HTTP response is sent**. They receive the raw DB result (before `readRoles`/`selectable` field-filtering) and can:

| Return | Effect |
|---|---|
| A **modified copy** of the result | The modified value is sent to the client (field-filtering is applied afterwards). |
| `void` / `undefined` | The original result is used unchanged. |
| **Throw any `Error`** | A successful DB write is replaced with an error response (useful for post-write validation). |

### Hook context

Every hook receives a context object as its last argument:

```ts
interface HookContext {
  auth: AuthContext      // resolved caller identity (userId, roles, permissions, claims)
  resource: ResourceDefinition  // the normalized resource being accessed
  req: HttpRequest       // raw HTTP request — headers, raw framework request, etc.
}
```

---

## Full hook reference

### Create — `POST /resource`

| Hook | Signature | Notes |
|---|---|---|
| `beforeCreate` | `(data, ctx) => data \| void` | Fires **once per record** — both for single-object and array POST bodies. |
| `afterCreate`  | `(result, ctx) => result \| void` | Fires **once per record**. Sees the full DB record before `readRoles` filtering. |

### Read — `GET /resource`

| Hook | Signature | Notes |
|---|---|---|
| `beforeReadMany` | `(options, ctx) => ListOptions \| void` | Modify pagination, inject extra `where` filters, force a sort. |
| `afterReadMany`  | `(result, ctx) => ListResult \| void` | Transform the full `{ count, results }` envelope. |

### Read — `GET /resource/:id`

| Hook | Signature | Notes |
|---|---|---|
| `beforeReadOne` | `(id, ctx) => void` | Throw to block; cannot modify the ID. |
| `afterReadOne`  | `(result, ctx) => result \| void` | Attach computed / virtual fields. |

### Update — `PATCH /resource/:id`

| Hook | Signature | Notes |
|---|---|---|
| `beforeUpdateOne` | `(id, data, ctx) => data \| void` | Modify the update payload (e.g. stamp audit fields). |
| `afterUpdateOne`  | `(result, ctx) => result \| void` | Transform the updated record. |

### Bulk update — `PATCH /resource`

| Hook | Signature | Notes |
|---|---|---|
| `beforeUpdateMany` | `(query, data, ctx) => void` | Throw to block; cannot modify the query or data. |
| `afterUpdateMany`  | `(result, ctx) => UpdateManyResult \| void` | Transform the `{ updated, results? }` response. |

### Upsert — `PUT /resource/:id`

| Hook | Signature | Notes |
|---|---|---|
| `beforeUpsertOne` | `(id, data, ctx) => data \| void` | Modify the upsert payload. |
| `afterUpsertOne`  | `(result, ctx) => result \| void` | Transform the resulting record. |

### Delete — `DELETE /resource/:id`

| Hook | Signature | Notes |
|---|---|---|
| `beforeDeleteOne` | `(id, ctx) => void` | The record still exists when this fires. Throw to abort. |
| `afterDeleteOne`  | `(id, ctx) => void` | The record is gone. Use for cleanup or event emission. Does **not** fire on 404. |

### Bulk delete — `DELETE /resource`

| Hook | Signature | Notes |
|---|---|---|
| `beforeDeleteMany` | `(query, ctx) => void` | Throw to block. |
| `afterDeleteMany`  | `(result, ctx) => DeleteManyResult \| void` | Transform the `{ deleted }` response. |

### Query builder — `POST /resource/query`

| Hook | Signature | Notes |
|---|---|---|
| `beforeQuery` | `(query, ctx) => IQueryOptions \| void` | Augment or restrict the query (e.g. inject a mandatory filter the client cannot remove). |
| `afterQuery`  | `(result, ctx) => QueryResult \| void` | Transform the `{ count, results }` response. |

---

## Common patterns

### Stamp audit fields

```ts
hooks: {
  beforeCreate:    (data, { auth }) => ({ ...data, createdBy: auth.userId }),
  beforeUpdateOne: (id, data, { auth }) => ({ ...data, updatedBy: auth.userId }),
}
```

### Emit domain events

```ts
hooks: {
  afterCreate:    async (result) => events.emit('post.created', result),
  afterUpdateOne: async (result) => events.emit('post.updated', result),
  afterDeleteOne: async (id)     => events.emit('post.deleted', { id }),
}
```

### Enforce ownership on reads

```ts
import { AuthorizationError } from '@edium/halifax'

hooks: {
  beforeReadOne: async (id, { auth }) => {
    const record = await db.post.findUnique({ where: { id: Number(id) } })
    if (record?.ownerId !== auth.userId) throw new AuthorizationError()
  }
}
```

### Restrict query-builder results to the caller's own data

Works as a server-side guard that clients cannot bypass, similar to tenant scoping:

```ts
hooks: {
  beforeQuery: (query, { auth }) => ({
    ...query,
    where: [
      ...(query.where ?? []),
      { field: 'ownerId', comparison: '=', value1: auth.userId, operator: 'AND' }
    ]
  })
}
```

### Soft-delete interception

Block reads on soft-deleted records even after the DB returns them:

```ts
hooks: {
  afterReadOne:  (result) => { if (result.deletedAt) throw new NotFoundError(); return result },
  afterReadMany: (result) => ({
    ...result,
    results: result.results.filter((r) => !r.deletedAt),
    count: result.results.filter((r) => !r.deletedAt).length
  })
}
```

### Validate business rules before a write

```ts
import { UnprocessableEntityError } from '@edium/halifax'

hooks: {
  beforeCreate: async (data) => {
    const exists = await db.user.findUnique({ where: { email: data.email } })
    if (exists) throw new UnprocessableEntityError('Email already registered.')
    return data
  }
}
```

---

## TypeScript generics

Hook callbacks are fully typed when you pass generics to `ResourceDefinition`:

```ts
interface Post { id: number; title: string; body: string; createdBy?: string }

const posts: ResourceDefinition<Post, Omit<Post, 'id' | 'createdBy'>, Partial<Post>> = {
  routePrefix: 'posts',
  repository: new PrismaAdapter({ delegate: prisma.post }),
  hooks: {
    // `data` is typed as `Omit<Post, 'id' | 'createdBy'>` ✓
    beforeCreate: (data, { auth }) => ({ ...data, createdBy: auth.userId }),
    // `result` is typed as `Post` ✓
    afterCreate: (result) => result
  }
}
```

---

## Execution order

For a `POST /resource` call, the full pipeline is:

```
request
  → auth & authorization check
  → field write-filtering (writable / writeRoles)
  → beforeCreate (per item)
  → repository.createOne / .createMany
  → afterCreate (per item)
  → field read-filtering (selectable / readRoles)
  → response
```

Hooks run **inside** the existing error-catching wrapper, so any `Error` thrown is automatically serialized as `{ errors: [{ code, message }] }` and the correct HTTP status is set.

---

## Relation to other extension points

| Extension point | When to use |
|---|---|
| **Hooks** | Per-resource logic that runs inside the Halifax pipeline (stamping, eventing, ownership checks, data transformation). |
| **AuthStrategy** | Cross-resource authentication and coarse-grained authorization applied to every route. |
| **Repository wrapper** | Low-level data-access customization (query rewriting, custom SQL, alternative storage). |
| **Framework middleware** | Transport-level concerns: CORS, rate limiting, request ID injection, body parsing. |
