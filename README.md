# Halifax

Halifax is an adapter-driven TypeScript framework for building standardized REST CRUD APIs automatically from resource definitions. It generates standards-compliant REST endpoints from your data models, wires up authentication, and exposes a dynamic query-builder endpoint for advanced read/update/delete operations.

The package is split into small, replaceable layers — nothing is imported into the core engine. Your ORM, HTTP server, and auth provider are all injected at startup.

## Why Halifax?

- 🚀 **Zero-boilerplate CRUD** — define a resource once and get standards-compliant REST endpoints (list, read, create, update, upsert, delete, bulk) with correct status codes and a consistent error shape.
- 🧩 **Adapter-driven & swappable** — your HTTP framework, ORM/database, and auth provider are injected, not baked in. Switch any layer without touching your resource definitions.
- 🌐 **4 HTTP frameworks, identical behavior** — Express 4/5, Fastify, HyperExpress, and Ultimate Express, all verified against one shared conformance suite.
- 🗄️ **7 databases, one adapter** — PostgreSQL, MySQL, MariaDB, SQL Server, SQLite, CockroachDB, and MongoDB via [Prisma](https://www.prisma.io/). The query builder compiles to portable Prisma calls (never raw SQL), so the **same client request behaves identically on every database** — switch engines by changing one line.
- 🔎 **Dynamic query-builder endpoint** — let the front-end compose rich filtered/sorted/paginated queries "for free" (`AND`/`OR`/nesting, `IN`, `BETWEEN`, `CONTAINS`, …) without hand-writing endpoints. Fully validated — bad fields/operators return structured `4xx` errors, never leaked DB internals.
- 🏢 **Multi-tenancy built in** — per-resource tenant scoping with fail-closed guarantees; one tenant can never read or write another's rows.
- ⚡ **Pluggable read-through caching** — in-memory or Redis, per-resource TTLs, never-expire mode, automatic write-invalidation, tenant-safe keys, and a `Cache-Control` bust header.
- 🔐 **Auth & field-level security** — API key, JWT/Bearer, and Passport strategies; per-action permissions; and `filterable`/`sortable`/`selectable`/`writable` flags enforced on every request.
- 🧪 **Type-safe & battle-tested** — strict TypeScript, ESM, ships full `.d.ts`; hundreds of unit tests plus real-database + Redis integration tests in CI.

## Current Support

| Layer          | Supported                                                                     |
| -------------- | ----------------------------------------------------------------------------- |
| HTTP server    | Express 4/5, Fastify, HyperExpress, Ultimate Express                          |
| ORM / database | Prisma 7 + Postgres, MySQL, MariaDB, SQL Server, SQLite, MongoDB, CockroachDB |
| Auth           | API key, JWT/Bearer, Passport + JWT                                           |
| Caching        | Pluggable read-through cache (in-memory default; bring Redis, etc.)           |

Every HTTP adapter is interchangeable and behaves identically — same routes, status codes,
error-body shape, and content negotiation — so you can switch frameworks without touching
your resource definitions, auth, or query logic. See
[README_HTTP_ADAPTERS.md](./README_HTTP_ADAPTERS.md) for per-framework usage.

The same is true across databases: the dynamic query-builder endpoint and all CRUD compile
to portable Prisma Client calls (never raw SQL), so the **same client request behaves
identically on every database** — switch engines by changing only the Prisma `provider`. The
integration suite runs unchanged against Postgres, MySQL, and SQLite in CI to keep that honest.

> **Roadmap** — This project welcomes community-written adapters for Drizzle, Sequelize, etc.

## Install

```bash
pnpm add @edium/halifax
pnpm add express @prisma/client
```

## Quick Start

```ts
import express from 'express'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  PrismaAdapter,
  ApiKeyAuthStrategy,
  createExpressCrudRouter,
  type ResourceDefinition
} from '@edium/halifax'

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) })

const posts: ResourceDefinition = {
  name: 'Post',
  routePrefix: 'posts',
  defaultLimit: 50,
  maxLimit: 200,
  fields: [
    { name: 'id', filterable: true, sortable: true },
    { name: 'title', filterable: true, sortable: true, writable: true },
    { name: 'content', writable: true },
    { name: 'published', filterable: true, writable: true }
  ],
  permissions: {
    allowUpdateMany: false,
    allowDeleteMany: false
  },
  repository: new PrismaAdapter({ delegate: prisma.post })
}

const app = express()
app.use(express.json())
app.use(
  '/api/v1',
  createExpressCrudRouter([posts], { authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY!) })
)
app.listen(3000)
```

## Documentation

| Guide                                                | Contents                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [README_AUTOCRUD.md](./README_AUTOCRUD.md)           | Resource definitions, field flags, ID types, pagination, query-string filtering, error shapes |
| [README_REPO_ADAPTERS.md](./README_REPO_ADAPTERS.md) | Prisma 7 setup, `PrismaAdapter` options, capabilities, custom repositories                    |
| [README_HTTP_ADAPTERS.md](./README_HTTP_ADAPTERS.md) | Express, Fastify, HyperExpress & Ultimate Express adapters, and custom HTTP adapters          |
| [README_AUTH.md](./README_AUTH.md)                   | Auth strategies (`ApiKey`, `JWT`, `Passport`), `requiredPermissions`, custom `authorize`      |
| [README_MULTITENANCY.md](./README_MULTITENANCY.md)   | Tenant isolation: `tenant` options, auto-detection, scoping guarantees, fail-closed behaviour |
| [README_QUERYBUILDER.md](./README_QUERYBUILDER.md)   | Query-builder payload, comparisons, nested filters, portable Prisma execution                 |
| [README_CACHE.md](./README_CACHE.md)                 | Read-through caching: in-memory & Redis stores, never-expire, cache-bust header               |

## Running Integration Tests

The integration suite tests the full stack against a real PostgreSQL database.

### 1. Start a Postgres container

```bash
docker run -d \
  --name halifax-test-db \
  --restart unless-stopped \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=halifax_test \
  -p 5432:5432 \
  postgres:17
```

### 2. Create `.env.test`

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/halifax_test"
```

### 3. Run

```bash
pnpm test:integration
```

`globalSetup` runs `prisma generate` and `prisma db push` automatically before any test executes.

### Subsequent runs

```bash
docker start halifax-test-db
pnpm test:integration
```

### Tear down

```bash
docker stop halifax-test-db && docker rm halifax-test-db
```
