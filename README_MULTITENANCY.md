# Multi-Tenancy

Halifax can confine every generated endpoint to a single tenant — a company, organization,
workspace, or any row-ownership boundary — so that one customer can never read or write
another customer's data through the API. Tenant isolation is **optional**, **opt-in**, and
enforced at the data-access layer where it cannot be bypassed by crafted query strings or
request bodies.

## How it works

Two pieces combine to produce a per-request constraint:

1. **The tenant field** — a column on the model that stores the tenant key (e.g. `companyId`).
   Declared per-resource via `ResourceDefinition.tenant`, or auto-detected (see below).
2. **The tenant value** — the key the _current caller_ is bound to (e.g. their `company.id`).
   Produced per-request by `tenant.resolveId(ctx)`, which reads it from the authenticated
   session/token — **never** from client-supplied input.

For each request, Halifax resolves the value and asks the repository for a **scoped clone**
(`repository.withScope({ field, value })`). That clone applies the constraint to every
operation:

| Operation                              | What the scope does                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /resource` (list & query-builder) | AND-s `field = value` into the `WHERE` (and the count)                            |
| `GET /resource/:id`                    | Reads via `findFirst` with the tenant filter → foreign rows return `404`          |
| `POST /resource`                       | **Stamps** `field = value` onto the body, overriding any client-supplied value    |
| `PATCH /resource/:id`                  | Verifies ownership first; **strips** the tenant field so rows can't change owners |
| `PATCH /resource` (updateMany)         | AND-s the tenant filter into the `WHERE`; strips the tenant field from the `SET`  |
| `PUT /resource/:id` (upsert)           | Refuses to overwrite a row owned by another tenant (`404`); stamps on create      |
| `DELETE /resource/:id`                 | Deletes via a scoped `deleteMany` → foreign rows report "not found"               |
| `DELETE /resource` (deleteMany)        | AND-s the tenant filter into the `WHERE`                                          |

## Quick start

```ts
import express from 'express'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  createPrismaResources,
  createExpressCrudRouter,
  PassportSessionStrategy
} from '@edium/halifax'
import { Prisma } from '@prisma/client'

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) })

// Generate resources for every model; mark any model that has a `companyId` column
// as tenant-scoped on it.
const resources = createPrismaResources(prisma, Prisma.dmmf.datamodel.models, {
  tenantField: 'companyId'
})

const app = express()
app.use(express.json())
// ...session + passport middleware run before Halifax...

app.use(
  '/api/v3',
  createExpressCrudRouter(resources, {
    authStrategy: new PassportSessionStrategy(),
    tenant: {
      // Derive the tenant key from the authenticated session — never from the request body.
      resolveId: ({ req }) => (req.raw as any).session?.company?.id ?? null
    }
  })
)
```

That's the whole integration: one `tenantField` to auto-detect scoped models, and one
`resolveId` to supply the caller's tenant. Models without a `companyId` column are left
global (unscoped) automatically.

## Configuration

### API-level: `tenant` on `CrudApiOptions`

```ts
interface TenantOptions {
  /** Resolve the caller's tenant key from the authenticated request. */
  resolveId: (ctx: { auth; req; resource }) => unknown | Promise<unknown>
  /** Default column to auto-detect scoping on. Defaults to 'tenantId'. */
  field?: string
  /** Fail-closed when no tenant resolves. Defaults to true. */
  strict?: boolean
}
```

> `resolveId` runs **after** authentication, so `ctx.auth` is the resolved `AuthContext`
> and `ctx.req.raw` is the underlying framework request (e.g. the Express `Request`, with
> `session` / `user` populated). Pull the tenant from there.

### Resource-level: `tenant` on `ResourceDefinition`

| Value            | Meaning                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `{ field: 'x' }` | Scope this resource on column `x`.                                                          |
| `false`          | Opt this resource **out** of an otherwise tenant-scoped API.                                |
| _omitted_        | Auto-scope on the API's default `field` **if** the model has that column; otherwise global. |

When generating with `createPrismaResources`, set it per model:

```ts
createPrismaResources(prisma, models, {
  tenantField: 'companyId',
  models: {
    // Override the column for one model:
    Invoice: { tenant: { field: 'orgId' } },
    // Expose a global reference table to all tenants:
    Country: { tenant: false }
  }
})
```

## Security model

Tenant scoping is designed to **fail closed**. The guarantees:

- **Enforced at the data layer.** The constraint is applied inside the repository on every
  read, write, and bulk operation — not as middleware a route could skip.
- **Server-derived value only.** The tenant value comes from `resolveId` (your auth/session),
  never from the URL, query string, or body. A client-supplied `?companyId=` or a `companyId`
  in the body is **overridden** (writes) or **AND-ed against** (reads), so it cannot widen access.
- **No `OR` escape in the query builder.** Caller-supplied filters are nested as a
  parenthesised group AND-ed beneath the tenant predicate — `companyId = $1 AND ( ...your filters... )`
  — so an `OR` in the advanced query can never break out of the tenant boundary.
- **Rows can't change owners.** The tenant field is stripped from update/upsert payloads.
- **Cross-tenant rows are invisible.** Reads/updates/deletes of another tenant's row behave
  as "not found" (`404`/no-op), never leaking existence.
- **Misconfiguration is fatal, not silent.** If a resource is tenant-scoped but its repository
  doesn't implement `withScope`, `createExpressCrudRouter` throws at startup rather than
  serving the resource unscoped.
- **Strict by default.** If `resolveId` returns `null`/`undefined` for a scoped resource, the
  request is rejected with `403`. Set `strict: false` only to deliberately allow cross-tenant
  ("god mode") access for callers with no tenant.

### Defense in depth

API-level scoping does not replace database-level controls. For a hard guarantee even against
bugs elsewhere in your stack, pair Halifax scoping with PostgreSQL **Row-Level Security**
policies keyed on the same tenant column.

### What is _not_ scoped

The `POST /query-builder/preview` endpoint only compiles a query to SQL for inspection and
never touches the database, so it is not tenant-scoped. Relations eager-loaded via `?include=`
are returned as Prisma resolves them; if a related model also needs isolation, expose it as its
own scoped resource rather than relying on the include.

## Custom repositories

Any repository can support scoping by implementing the optional `withScope` method, which must
return a **new** instance bound to the scope (never mutate the original):

```ts
withScope(scope: TenantScope): Repository<...> {
  return new MyRepository({ ...this.options, scope })
}
```

`PrismaAdapter` implements this for you. A repository that omits `withScope` simply cannot be
used for a tenant-scoped resource — the router refuses to register it, by design.
