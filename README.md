# Halifax

[![CI](https://github.com/splayfee/halifax/actions/workflows/ci.yml/badge.svg)](https://github.com/splayfee/halifax/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@edium/halifax.svg)](https://www.npmjs.com/package/@edium/halifax)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)

Halifax is an adapter-driven TypeScript framework for building standardized REST CRUD APIs automatically from resource definitions. It generates standards-compliant REST endpoints from your data models, wires up authentication, and exposes a dynamic query-builder endpoint for advanced read/update/delete operations.

The package is split into small, replaceable layers — nothing is imported into the core engine. Your ORM, HTTP server, and auth provider are all injected at startup.

## Why Halifax?

- 🚀 **Zero-boilerplate CRUD** — define a resource once and get standards-compliant REST endpoints (list, read, create, update, upsert, delete, bulk) with correct status codes and a consistent error shape.
- 🧩 **Adapter-driven & swappable** — your HTTP framework, ORM/database, and auth provider are injected, not baked in. Switch any layer without touching your resource definitions.
- 🌐 **4 HTTP frameworks, identical behavior** — Express 4/5, Fastify, HyperExpress, and Ultimate Express, all verified against one shared conformance suite.
- 🗄️ **Six databases, one adapter** — PostgreSQL, MySQL, MariaDB, SQL Server, CockroachDB, and SQLite via [Prisma](https://www.prisma.io/). The query builder compiles to portable Prisma calls (never raw SQL), so the **same client request behaves identically on every database** — switch engines by changing one line. Every engine is verified in CI against a real database — one matrix leg each, the same suite on all.
- 🔎 **Dynamic query-builder endpoint** — let the front-end compose rich filtered/sorted/paginated queries "for free" (`AND`/`OR`/nesting, `IN`, `BETWEEN`, `CONTAINS`, …) without hand-writing endpoints. Fully validated — bad fields/operators return structured `4xx` errors, never leaked DB internals.
- 🏢 **Multi-tenancy built in** — per-resource tenant scoping with fail-closed guarantees; one tenant can never read or write another's rows.
- ⚡ **Pluggable read-through caching** — in-memory or Redis, per-resource TTLs, never-expire mode, automatic write-invalidation, tenant-safe keys, and a `Cache-Control` bust header.
- 🔐 **Auth & field-level security** — API key, JWT/Bearer, and Passport strategies; per-action permissions; and `filterable`/`sortable`/`selectable`/`writable` flags enforced on every request.
- 🧪 **Type-safe & battle-tested** — strict TypeScript, ESM, ships full `.d.ts`; hundreds of unit tests plus the full integration suite run against six real databases + Redis in CI.

## Current Support

| Layer          | Supported                                                                 |
| -------------- | ------------------------------------------------------------------------- |
| HTTP server    | Express 4/5, Fastify, HyperExpress, Ultimate Express                      |
| ORM / database | Prisma 6 or 7 + Postgres, MySQL, MariaDB, SQL Server, CockroachDB, SQLite |
| Auth           | API key, JWT/Bearer, Passport + JWT                                       |
| Caching        | Pluggable read-through cache (in-memory default; bring Redis, etc.)       |

Every HTTP adapter is interchangeable and behaves identically — same routes, status codes,
error-body shape, and content negotiation — so you can switch frameworks without touching
your resource definitions, auth, or query logic. See
[README_HTTP_ADAPTERS.md](./README_HTTP_ADAPTERS.md) for per-framework usage.

The same is true across databases: the dynamic query-builder endpoint and all CRUD compile
to portable Prisma Client calls (never raw SQL), so the **same client request behaves
identically on every database** — switch engines by changing only the Prisma `provider`. The
integration suite runs unchanged against all six engines — Postgres, MySQL, MariaDB, SQL Server,
CockroachDB, and SQLite — in CI (one matrix leg per engine) to keep that honest.

> **MongoDB — coming back.** MongoDB is absent from the list above for one reason only:
> **Prisma ORM v7 dropped its MongoDB connector** (Prisma's own guidance is to stay on v6 for
> Mongo; v7 support is "coming soon"). This is a Prisma limitation, not a Halifax one —
> `PrismaAdapter` is database-agnostic and never touches the connection. The
> `schema.mongodb.prisma` and an `ObjectId`-aware integration suite are already in the repo, so
> **the moment Prisma restores MongoDB support in v7, Halifax will add it back** — it rejoins
> the CI matrix unchanged, with no API changes for you. Need MongoDB today? It still works on
> **Prisma 6**, which Halifax also supports — see [README_REPO_ADAPTERS.md](./README_REPO_ADAPTERS.md).
>
> **Roadmap** — community-written adapters for Drizzle, Sequelize, etc. are also welcome.

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

// Permissive + minimal by default: only `routePrefix`, `repository`, and `fields` are required.
// Every field is filterable / sortable / selectable / writable unless you turn it off, and the
// primary key is never writable. Every CRUD action is enabled unless you disable it.
const posts: ResourceDefinition = {
  routePrefix: 'posts',
  repository: new PrismaAdapter({ delegate: prisma.post }),
  fields: [{ name: 'id' }, { name: 'title' }, { name: 'content' }, { name: 'published' }]

  // Everything below is OPTIONAL — shown here just to illustrate the exceptions you *can* set:
  // name: 'Post',                       // defaults to a title-cased routePrefix ('posts' → 'Posts')
  // permissions: { allowDeleteMany: false }, // all actions on by default; list only what to disable
  // defaultLimit: 5000, maxLimit: 5000, // these are the defaults already (0 / 0 = no pagination)
}

const app = express()
app.use(express.json())
app.use(
  '/api/v1',
  createExpressCrudRouter([posts], { authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY!) })
)
app.listen(3000)
```

> **Even less boilerplate.** For a Prisma-backed API, `createPrismaResources(prisma, Prisma.dmmf.datamodel.models)`
> derives a fully-configured resource for **every** model — no `fields`, no `routePrefix`, nothing
> to hand-write — and you override only the exceptions per model. The hand-built resource above is
> the path for custom, non-Prisma repositories. See
> [README_REPO_ADAPTERS.md](./README_REPO_ADAPTERS.md) for both, and
> [README_AUTOCRUD.md](./README_AUTOCRUD.md) for a "verbose mode" resource with every option
> annotated.

## Documentation

| Guide                                                | Contents                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [README_AUTOCRUD.md](./README_AUTOCRUD.md)           | Resource definitions, field flags, ID types, pagination, query-string filtering, error shapes |
| [README_REPO_ADAPTERS.md](./README_REPO_ADAPTERS.md) | Prisma 7 (and 6) setup, `PrismaAdapter` options, capabilities, custom repositories            |
| [README_HTTP_ADAPTERS.md](./README_HTTP_ADAPTERS.md) | Express, Fastify, HyperExpress & Ultimate Express adapters, and custom HTTP adapters          |
| [README_AUTH.md](./README_AUTH.md)                   | Auth strategies (`ApiKey`, `JWT`, `Passport`), `requiredPermissions`, custom `authorize`      |
| [README_MULTITENANCY.md](./README_MULTITENANCY.md)   | Tenant isolation: `tenant` options, auto-detection, scoping guarantees, fail-closed behaviour |
| [README_QUERYBUILDER.md](./README_QUERYBUILDER.md)   | Query-builder payload, comparisons, nested filters, portable Prisma execution                 |
| [README_CACHE.md](./README_CACHE.md)                 | Read-through caching: in-memory & Redis stores, never-expire, cache-bust header               |

## Examples

Runnable, self-contained examples live in [`examples/`](./examples) — each is a complete server
you can start with `pnpm tsx examples/<file>.ts`:

- **One per HTTP adapter** — `http-express.ts` (the canonical one, with an annotated "verbose
  mode"), `http-fastify.ts`, `http-hyper-express.ts`, `http-ultimate-express.ts`. Same resources,
  same behaviour; only the framework wiring differs.
- **One per database** — `db-postgres.ts`, `db-mysql.ts`, `db-mariadb.ts`, `db-mssql.ts`,
  `db-cockroachdb.ts`, `db-sqlite.ts`. Express + Prisma against each engine; only the driver
  adapter and connection string change.

## Running Integration Tests

The integration suite runs the full stack against a **real database**, and the _same_ suite runs
unchanged against every supported engine. `docker-compose.test.yml` brings up one container per
engine (SQLite is embedded, so it needs none); `HALIFAX_DB` + `DATABASE_URL` select which one a
run targets, and `globalSetup` runs `prisma generate` + `prisma db push` automatically.

### Run against every database

```bash
docker compose -f docker-compose.test.yml up -d --wait   # postgres, mysql, mariadb, mssql, cockroachdb, redis
pnpm test:integration:all                                 # runs the suite against all six engines
docker compose -f docker-compose.test.yml down -v         # tear everything down
```

### Run against a single database

`pnpm test:integration` targets PostgreSQL by default (via `.env.test`). To target one specific
engine, use the matrix script — it sets the right `DATABASE_URL` for you:

```bash
docker compose -f docker-compose.test.yml up -d --wait cockroachdb redis
bash scripts/integration-matrix.sh cockroachdb       # or: postgres | mysql | mariadb | mssql | sqlite
```

Or the classic single-Postgres flow with a `.env.test` file:

```bash
# .env.test
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/halifax_test"
```

```bash
pnpm test:integration
```

> MongoDB is not in the matrix yet — Prisma 7 dropped MongoDB support (coming soon in v7). The
> schema and ObjectId-aware suite are already in place and rejoin the matrix unchanged once
> Prisma supports it.
