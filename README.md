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
import {
  PrismaRepositoryAdapter,
  PassportJwtStrategy,
  createExpressCrudRouter,
  type ResourceDefinition
} from '@edium/halifax'

const prisma = new PrismaClient()

const posts: ResourceDefinition = {
  name: 'Post',
  routePrefix: 'posts',
  tableName: 'posts',
  fields: [
    { name: 'id', filterable: true, sortable: true },
    { name: 'title', filterable: true, sortable: true, writable: true },
    { name: 'content', writable: true },
    { name: 'published', filterable: true, writable: true }
  ],
  relations: [{ name: 'author', includable: true }],
  permissions: {
    allowCreate: true,
    allowReadOne: true,
    allowReadMany: true,
    allowUpdateOne: true,
    allowDeleteOne: true
  },
  repository: new PrismaRepositoryAdapter({
    delegate: prisma.post as any,
    client: prisma,
    tableName: 'posts'
  })
}

const app = express()
app.use(express.json())
app.use(
  '/api',
  createExpressCrudRouter([posts], {
    authStrategy: new PassportJwtStrategy({ passport })
  })
)

app.listen(3000)
```

## Core Concepts

### HTTP server adapter

All transports implement the same interface:

```ts
interface HttpServer {
  registerRoute(method, path, handler): void
  start(port, host?): Promise<void> | void
}
```

Current adapter: `ExpressHttpServer` / `createExpressCrudRouter`

### Repository adapter

All ORM implementations expose the same repository contract:

```ts
interface Repository<TRecord, TCreate, TUpdate> {
  getOne(id, options?)
  getMany(options?)
  createOne(data)
  createMany(data)
  updateOne(id, data)
  deleteOne(id)
  updateMany?(query, data) // requires client + tableName
  deleteMany?(query) // requires client + tableName
  executeQueryBuilder?(query) // requires client + tableName
}
```

Current adapter: `PrismaRepositoryAdapter`

When using `updateMany`, `deleteMany`, or `executeQueryBuilder`, pass a `client` (your `PrismaClient`) and a `tableName` to the adapter so it can fall back to parameterized raw SQL.

### Auth strategies

```ts
interface AuthStrategy {
  authenticate(req): AuthContext | Promise<AuthContext>
  authorize?(params): boolean | Promise<boolean>
}
```

| Strategy                | Description                                |
| ----------------------- | ------------------------------------------ |
| `AllowAllAuthStrategy`  | No auth — development only                 |
| `ApiKeyAuthStrategy`    | `x-api-key` header check                   |
| `JwtClaimsAuthStrategy` | Bearer token with a custom verify callback |
| `PassportJwtStrategy`   | Drop-in for Passport + `passport-jwt`      |

## Generated Routes

Routes are created from the enabled `permissions` flags on each resource:

| Permission flag                 | Method   | Path                   |
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

## Query Builder

The `POST /:resource/query-builder` endpoint accepts a JSON payload and executes parameterized SQL via the adapter's native query path:

```json
{
  "tableName": "posts",
  "fields": ["id", "title"],
  "where": [{ "field": "published", "comparison": "=", "value1": true }],
  "orderBy": [{ "field": "id", "order": "DESC" }],
  "limit": 25,
  "offset": 0
}
```

The query builder emits ANSI SQL with `OFFSET x ROWS FETCH NEXT n ROWS ONLY` pagination, which is supported by PostgreSQL 8.4+.

## Running Integration Tests

The integration suite tests the full stack — `PrismaRepositoryAdapter`, Express routing, auth strategies, and the query builder — against a real PostgreSQL database.

### Prerequisites

- Docker Desktop (or any local Postgres instance)

### 1. Start a Postgres container

```bash
docker run -d \
  --name halfax-test-db \
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

This file is already covered by `.gitignore` via the `.env*` pattern.

### 3. Run the tests

```bash
pnpm test:integration
```

The `globalSetup` then runs `prisma generate` (writes `Post`/`Author` types into `@prisma/client`) and `prisma db push` (creates the tables) before any test executes. No separate setup step is needed.

### Subsequent runs

The container persists between runs — you only need to restart it if it was stopped:

```bash
docker start halifax-test-db
pnpm test:integration
```

### Tear down

```bash
docker stop halifax-test-db && docker rm halifax-test-db
```

## Per-Resource Permissions

`requiredPermissions` maps each CRUD action to a list of roles or permission strings that the authenticated user must satisfy:

```ts
requiredPermissions: {
  readMany:  ['posts.read'],
  create:    ['posts.create'],
  updateOne: ['posts.update'],
  deleteOne: ['posts.delete'],
}
```
