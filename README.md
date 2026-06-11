# Halifax

Halifax is an adapter-driven TypeScript framework for building standardized REST CRUD APIs automatically from resource definitions. It generates standards-compliant REST endpoints from your data models, wires up authentication, and exposes an optional SQL query-builder for advanced read/update/delete operations.

The package is split into small, replaceable layers — nothing is imported into the core engine. Your ORM, HTTP server, and auth provider are all injected at startup.

## Current Support

| Layer          | Supported                           |
| -------------- | ----------------------------------- |
| HTTP server    | Express 5                           |
| ORM / database | Prisma 7 + PostgreSQL               |
| Auth           | API key, JWT/Bearer, Passport + JWT |

> **Roadmap** — Fastify, Hyper Express, Sequelize, MSSQL, MySQL, and SQLite adapters are planned for future releases.

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
  tableName: 'posts',
  defaultLimit: 50,
  maxLimit: 200,
  fields: [
    { name: 'id', filterable: true, sortable: true },
    { name: 'title', filterable: true, sortable: true, writable: true },
    { name: 'content', writable: true },
    { name: 'published', filterable: true, writable: true }
  ],
  permissions: {
    allowCreate: true,
    allowReadOne: true,
    allowReadMany: true,
    allowUpdateOne: true,
    allowDeleteOne: true
  },
  repository: new PrismaAdapter({
    delegate: prisma.post,
    client: prisma,
    tableName: 'posts'
  })
}

const app = express()
app.use(express.json())
app.use(
  '/api',
  createExpressCrudRouter([posts], { authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY!) })
)
app.listen(3000)
```

## Documentation

| Guide                                              | Contents                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [README_AUTOCRUD.md](./README_AUTOCRUD.md)         | Resource definitions, field flags, ID types, pagination, query-string filtering, error shapes |
| [README_REPOSITORIES.md](./README_REPOSITORIES.md) | Prisma 7 setup, `PrismaAdapter` options, capabilities, custom repositories                    |
| [README_ADAPTERS.md](./README_ADAPTERS.md)         | Express adapter, `createExpressCrudRouter`, custom HTTP adapters                              |
| [README_AUTH.md](./README_AUTH.md)                 | Auth strategies (`ApiKey`, `JWT`, `Passport`), `requiredPermissions`, custom `authorize`      |
| [README_QUERYBUILDER.md](./README_QUERYBUILDER.md) | Query builder payload, comparisons, nested filters, `QueryBuilder` class                      |

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
