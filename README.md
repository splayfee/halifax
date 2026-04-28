# Halifax

Halifax is an adapter-driven TypeScript framework for building standardized REST CRUD APIs and SQL-backed advanced query endpoints automatically from resource definitions. It is highly adaptable and automatically generates standards-compliant REST endpoints from data models.

The package is intentionally split into small replaceable layers:

- **HTTP server adapters**: `HttpServer` interface with Express, Fastify, and Hyper Express adapters.
- **Repository adapters**: `Repository` interface with Prisma and Sequelize adapters.
- **Auth strategies**: `AuthStrategy` interface for API keys, JWT/OAuth, Auth0, Firebase, Passport, or custom authorization.
- **Core REST engine**: CRUD route registration, validation, query-string parsing, permission checks, and query-builder integration.
- **SQL query builder**: SQL Server-oriented parameterized SQL generation for advanced read/update/delete operations.

Halifax does not import Prisma, Sequelize, Fastify, Express, or Hyper Express inside the core service layer. Those technologies are injected at initialization through adapters.

## Install

```bash
pnpm add halifax
```

Install only the adapters you use:

```bash
pnpm add hyper-express @prisma/client
# or
pnpm add express sequelize
# or
pnpm add fastify @prisma/client
```

## Core Concepts

### 1. HTTP server adapter

All transports implement the same interface:

```ts
interface HttpServer {
  registerRoute(method, path, handler): void
  start(port, host?): Promise<void> | void
}
```

Provided adapters:

- `ExpressHttpServer`
- `FastifyHttpServer`
- `HyperExpressHttpServer`

### 2. Repository adapter

All database/ORM implementations expose the same repository contract:

```ts
interface Repository<TRecord, TCreate, TUpdate> {
  getOne(id, options?)
  getMany(options?)
  createOne(data)
  createMany(data)
  updateOne(id, data)
  deleteOne(id)
  executeQueryBuilder?(query)
}
```

Provided adapters:

- `PrismaRepositoryAdapter`
- `SequelizeRepositoryAdapter`
- `InMemoryDataAdapter` for unit tests/examples

### 3. Auth strategy

Authentication and authorization are swappable:

```ts
interface AuthStrategy {
  authenticate(req): AuthContext | Promise<AuthContext>
  authorize?(params): boolean | Promise<boolean>
}
```

Provided strategies/stubs:

- `AllowAllAuthStrategy`
- `ApiKeyAuthStrategy`
- `JwtClaimsAuthStrategy`
- `PassportAuthStrategy`
- `Auth0JwtStrategy`
- `FirebaseJwtStrategy`

The Auth0/Firebase/Passport classes are intentionally lightweight strategy wrappers. Bring your own verification logic and inject it.

## Hyper Express + Prisma Example

```ts
import HyperExpress from 'hyper-express'
import { PrismaClient } from '@prisma/client'
import {
  ApiKeyAuthStrategy,
  HyperExpressHttpServer,
  PrismaRepositoryAdapter,
  registerCrudApi,
  type ResourceDefinition
} from 'halifax'

const app = new HyperExpress.Server()
const prisma = new PrismaClient()

const users: ResourceDefinition = {
  name: 'User',
  routePrefix: 'users',
  tableName: 'Users',
  fields: [
    { name: 'id', filterable: true, sortable: true },
    { name: 'email', filterable: true, sortable: true },
    { name: 'displayName', filterable: true, sortable: true }
  ],
  relations: [{ name: 'posts', includable: true }],
  permissions: {
    allowCreate: true,
    allowReadOne: true,
    allowReadMany: true,
    allowReadManyWithQueryBuilder: true,
    allowUpdateOne: true,
    allowDeleteOne: true
  },
  requiredPermissions: {
    readMany: ['users.read'],
    create: ['users.create'],
    updateOne: ['users.update'],
    deleteOne: ['users.delete']
  },
  repository: new PrismaRepositoryAdapter({
    delegate: prisma.user,
    client: prisma,
    tableName: 'Users'
  })
}

registerCrudApi(new HyperExpressHttpServer(app), [users], {
  authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY ?? '')
})

await app.listen(3000)
```

## SQL Server / Microsoft SQL Testing

The current query builder emits SQL Server-style pagination:

```sql
OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY
```

That makes Microsoft SQL Server the right first integration database for the SQL query-builder path. Use Prisma or Sequelize against SQL Server for standard CRUD, and use the native query path for complex query-builder operations.

Recommended local testing stack:

- Hyper Express for the HTTP adapter
- SQL Server for query-builder integration tests
- Prisma or Sequelize repository adapter for CRUD tests

## Public Package Guidance

For a credible public `1.0.0`, keep the initial guarantee narrow:

- Core CRUD route engine
- Hyper Express, Express, and Fastify HTTP adapters
- Prisma and Sequelize repository adapters
- Pluggable auth strategy
- SQL Server query-builder support
- Explicit capability boundaries for raw SQL vs ORM CRUD