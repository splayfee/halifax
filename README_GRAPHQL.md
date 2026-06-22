# Halifax GraphQL

Halifax can automatically expose a GraphQL API alongside your REST endpoints. The schema is generated at startup from the same resource definitions that drive REST — no extra annotation or separate schema file required.

GraphQL is **opt-in**: nothing happens unless you explicitly set `enabled: true`.

## Contents

- [Installation](#installation)
- [Enabling GraphQL](#enabling-graphql)
- [What gets generated](#what-gets-generated)
- [Per-resource opt-out](#per-resource-opt-out)
- [GraphiQL IDE](#graphiql-ide)
- [Authentication](#authentication)
- [Tenant scoping and admin bypass](#tenant-scoping-and-admin-bypass)
- [Query examples](#query-examples)
- [Mutation examples](#mutation-examples)
- [Types reference](#types-reference)

---

## Installation

The `graphql` package is a peer dependency — install it alongside Halifax:

```bash
npm install graphql
# or
pnpm add graphql
```

Halifax is tested against `graphql` v16.

---

## Enabling GraphQL

Pass `graphql: { enabled: true }` to `registerCrudApi` (or `createExpressCrudRouter`):

```ts
import { createExpressCrudRouter } from '@edium/halifax'

const app = createExpressCrudRouter(resources, {
  graphql: {
    enabled: true, // required — GraphQL is off by default
    path: '/graphql', // default: '/graphql'
    graphiql: true, // default: true — serve the GraphiQL IDE at GET /graphql
    requireAuth: false, // default: false — set true to require auth before any operation
    title: 'My API' // browser tab title in GraphiQL
  }
})
```

Two routes are registered:

| Route           | Purpose                                               |
| --------------- | ----------------------------------------------------- |
| `POST /graphql` | Execute GraphQL queries and mutations                 |
| `GET /graphql`  | GraphiQL browser IDE (disable with `graphiql: false`) |

---

## What gets generated

For every resource Halifax generates:

**Query fields**

| Field                                                                       | REST equivalent          | Description                                 |
| --------------------------------------------------------------------------- | ------------------------ | ------------------------------------------- |
| `get<Resource>(id: ID!)`                                                    | `GET /<resource>/:id`    | Fetch one record by ID                      |
| `list<Resource>(filter, limit, offset, orderBy, include)`                   | `GET /<resource>`        | Paginated list with equality filters        |
| `query<Resource>(where, fields, distinct, limit, offset, orderBy, include)` | `POST /<resource>/query` | Advanced query with full filter expressions |

**Mutation fields**

| Field                                 | REST equivalent                 | Description             |
| ------------------------------------- | ------------------------------- | ----------------------- |
| `create<Resource>(input)`             | `POST /<resource>`              | Create one record       |
| `createMany<Resource>(input)`         | `POST /<resource>` (array body) | Create multiple records |
| `update<Resource>(id, input)`         | `PATCH /<resource>/:id`         | Partial update          |
| `updateMany<Resource>(where, update)` | `PATCH /<resource>`             | Bulk update             |
| `upsert<Resource>(id, input)`         | `PUT /<resource>/:id`           | Create or replace       |
| `delete<Resource>(id)`                | `DELETE /<resource>/:id`        | Delete one record       |
| `deleteMany<Resource>(where)`         | `DELETE /<resource>`            | Bulk delete             |

Only operations allowed by `resource.permissions` are included. If `allowDeleteMany: false`, no `deleteMany<Resource>` mutation is generated.

---

## Per-resource opt-out

Set `graphql: false` on any resource to exclude it from the GraphQL schema entirely:

```ts
const resources = [
  {
    routePrefix: 'users',
    repository: userRepo
    // visible in REST and GraphQL (default)
  },
  {
    routePrefix: 'audit-logs',
    repository: auditRepo,
    graphql: false // REST only — excluded from GraphQL
  }
]
```

---

## GraphiQL IDE

When `graphiql: true` (the default), visiting `GET /graphql` in a browser opens the GraphiQL IDE. You can explore the auto-generated schema using introspection, run queries interactively, and inspect the full type system.

To disable the IDE (e.g. in production):

```ts
graphql: { enabled: true, graphiql: false }
```

---

## Authentication

GraphQL uses the same `authStrategy` as REST. Every resolver calls `authenticate` before executing, so your JWT/API-key validation fires automatically.

To require authentication before even responding to introspection queries, set `requireAuth: true`:

```ts
graphql: { enabled: true, requireAuth: true }
```

Fine-grained permissions (`resource.requiredPermissions`) apply per resolver, identical to REST. Per-field `readRoles`/`writeRoles` restrictions are also enforced — restricted fields are stripped from resolver results.

---

## Tenant scoping and admin bypass

The GraphQL endpoint respects the same tenant isolation that REST does. Each resolver resolves the tenant from the caller's auth context (JWT claims, session, etc.) and scopes the repository automatically — regular users can only see their own tenant's data. The tenant value is **always derived from auth**, never from client-supplied input.

### Admin bypass

Admins who need to query across all tenants can be granted bypass access by listing their roles or permission slugs in `TenantOptions.bypassRoles` (API-wide default) or `ResourceDefinition.bypassTenantRoles` (per-resource override).

```ts
createExpressCrudRouter(resources, {
  tenant: {
    resolveId: (ctx) => ctx.auth.claims?.companyId,
    bypassRoles: ['super_admin', 'support:read-all'] // role OR permission slug
  }
})
```

**How it works:**

- **Bypass role → all records.** An admin whose `auth.roles` or `auth.permissions` matches any entry in `bypassRoles` gets an unscoped read — all rows across all tenants.
- **No bypass role → normal scoping.** Regular users are always scoped to their tenant. The bypass path is unreachable for them.
- **Writes are never bypassed.** Write operations always resolve the tenant through `resolveId`. An admin whose token carries a `companyId` writes to that company; one without a tenant receives 403 (unless `strict: false`). The tenant field on writes always comes from auth — never from the client.

**Narrowing to a single tenant (admin reads):**

When an admin wants to see just one tenant's data, they use the same filter mechanism as any other caller — the tenant field is just another filterable column:

```graphql
# All tenants (bypass active, no filter)
{
  listOrders {
    count
    results {
      id
      companyId
      total
    }
  }
}

# One specific tenant — admin narrows with a filter
{
  listOrders(filter: { companyId: 42 }) {
    count
    results {
      id
      companyId
      total
    }
  }
}

# Or with the full query builder
{
  queryOrders(where: [{ field: "companyId", comparison: "=", value1: 42 }]) {
    count
    results {
      id
      companyId
      total
    }
  }
}
```

On REST it works the same way:

```
# All tenants
GET /orders

# One tenant
GET /orders?companyId=42
```

No special header or query parameter needed — the normal filter API handles it.

#### Per-resource bypass override

Override the global `bypassRoles` for a single resource — or disable bypass entirely for sensitive models:

```ts
const resources = [
  {
    routePrefix: 'orders',
    repository: orderRepo
    // inherits bypassRoles from TenantOptions
  },
  {
    routePrefix: 'payment-methods',
    repository: paymentRepo,
    bypassTenantRoles: [] // no one bypasses tenant on this resource
  },
  {
    routePrefix: 'users',
    repository: userRepo,
    bypassTenantRoles: ['super_admin'] // only super_admin, not support:read-all
  }
]
```

---

## Query examples

### Fetch one record

```graphql
query {
  getUser(id: "42") {
    id
    name
    email
  }
}
```

### Paginated list with filters

```graphql
query {
  listUsers(
    filter: { status: "active" }
    limit: 20
    offset: 0
    orderBy: [{ field: "createdAt", direction: desc }]
  ) {
    count
    results {
      id
      name
      email
    }
  }
}
```

### Advanced query (full filter expressions)

```graphql
query {
  queryUsers(
    where: [
      { field: "status", comparison: "IN", value1: ["active", "trial"] }
      { operator: "AND" }
      { field: "createdAt", comparison: ">=", value1: "2025-01-01" }
    ]
    orderBy: [{ field: "name", direction: asc }]
    limit: 50
  ) {
    count
    results {
      id
      name
      email
    }
  }
}
```

### With variables

```graphql
query ListActiveUsers($status: String!, $limit: Int) {
  listUsers(filter: { status: $status }, limit: $limit) {
    count
    results {
      id
      name
    }
  }
}
```

Variables payload:

```json
{ "status": "active", "limit": 10 }
```

---

## Mutation examples

### Create

```graphql
mutation {
  createUser(input: { name: "Alice", email: "alice@example.com" }) {
    id
    name
    email
  }
}
```

### Partial update

```graphql
mutation {
  updateUser(id: "42", input: { name: "Alice Smith" }) {
    id
    name
  }
}
```

### Bulk update

```graphql
mutation {
  updateManyUser(
    where: [{ field: "status", comparison: "=", value1: "trial" }]
    update: { status: "active" }
  ) {
    updated
  }
}
```

### Delete

```graphql
mutation {
  deleteUser(id: "42")
}
```

---

## Types reference

| Type                     | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `GraphQLOptions`         | Configuration object passed to `registerCrudApi` / `createExpressCrudRouter` |
| `GraphQLResourceContext` | Internal per-resource context (available if building custom integrations)    |
| `GraphQLResolverContext` | The `contextValue` available in every resolver: `{ req: HttpRequest }`       |

All types are re-exported from `@edium/halifax`:

```ts
import type { GraphQLOptions, GraphQLResourceContext, GraphQLResolverContext } from '@edium/halifax'
```
