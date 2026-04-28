# Using Halifax

This guide shows the intended package shape after extracting Halifax from the original application.

## 1. Pick an HTTP adapter

Use Hyper Express for development/testing if that is your target runtime:

```ts
import HyperExpress from 'hyper-express'
import { HyperExpressHttpServer } from 'halifax'

const app = new HyperExpress.Server()
const server = new HyperExpressHttpServer(app)
```

Express and Fastify are also supported:

```ts
import express from 'express'
import { ExpressHttpServer } from 'halifax'

const app = express()
app.use(express.json())
const server = new ExpressHttpServer(app)
```

```ts
import Fastify from 'fastify'
import { FastifyHttpServer } from 'halifax'

const app = Fastify()
const server = new FastifyHttpServer(app)
```

## 2. Pick a repository adapter

### Prisma

```ts
import { PrismaClient } from '@prisma/client'
import { PrismaRepositoryAdapter } from 'halifax'

const prisma = new PrismaClient()

const userRepository = new PrismaRepositoryAdapter({
  delegate: prisma.user,
  client: prisma,
  tableName: 'Users'
})
```

The adapter does not import `@prisma/client`. The consuming application owns the Prisma client and injects the delegate.

### Sequelize

```ts
import { QueryTypes } from 'sequelize'
import { SequelizeRepositoryAdapter } from 'halifax'
import { sequelize, User } from './models.js'

const userRepository = new SequelizeRepositoryAdapter({
  model: User,
  sequelize,
  tableName: 'Users',
  queryTypes: {
    select: QueryTypes.SELECT,
    update: QueryTypes.UPDATE,
    delete: QueryTypes.DELETE
  }
})
```

The adapter does not import Sequelize. The consuming application injects the model, connection, and optional query-type constants.

## 3. Pick an auth strategy

### API key

```ts
import { ApiKeyAuthStrategy } from 'halifax'

const authStrategy = new ApiKeyAuthStrategy(process.env.API_KEY ?? '')
```

### JWT / OAuth / Auth0 / Firebase

```ts
import { JwtClaimsAuthStrategy } from 'halifax'

const authStrategy = new JwtClaimsAuthStrategy(async (token) => {
  const claims = await verifyTokenWithYourProvider(token)

  return {
    isAuthenticated: true,
    userId: claims.sub,
    roles: claims.roles ?? [],
    permissions: claims.permissions ?? [],
    claims
  }
})
```

You can use the same pattern for Auth0, Firebase, Passport JWT, local auth, or any OAuth/OIDC provider.

## 4. Define a resource

```ts
import type { ResourceDefinition } from 'halifax'

const users: ResourceDefinition = {
  name: 'User',
  routePrefix: 'users',
  tableName: 'Users',
  fields: [
    { name: 'id', filterable: true, sortable: true, selectable: true },
    { name: 'email', filterable: true, sortable: true, selectable: true, writable: true },
    { name: 'displayName', filterable: true, sortable: true, selectable: true, writable: true }
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
    readOne: ['users.read'],
    create: ['users.create'],
    updateOne: ['users.update'],
    deleteOne: ['users.delete']
  },
  repository: userRepository
}
```

## 5. Register the API

```ts
import { registerCrudApi } from 'halifax'

registerCrudApi(server, [users], { authStrategy })
await server.start(3000)
```

Routes are generated from enabled permissions:

- `GET /users`
- `GET /users/:id`
- `POST /users`
- `PATCH /users/:id`
- `DELETE /users/:id`
- `POST /users/query-builder`

## 6. Query builder endpoint

The advanced query builder accepts a JSON payload and emits parameterized SQL through the repository adapter's native query capability.

Example:

```json
{
  "tableName": "Users",
  "fields": ["id", "email"],
  "where": [
    {
      "field": "email",
      "comparison": "LIKE",
      "value1": "%@example.com"
    }
  ],
  "orderBy": [
    { "field": "id", "order": "DESC" }
  ],
  "limit": 25,
  "offset": 0
}
```

Current SQL generation is SQL Server-oriented. Keep this explicit until more dialect compilers are added.

## 7. Microsoft SQL development/testing

For your development setup:

1. Run SQL Server locally or in a dev container.
2. Use Hyper Express as the HTTP adapter.
3. Use Prisma or Sequelize configured for SQL Server.
4. Use `POST /:resource/query-builder` to test advanced SQL paths.
5. Keep integration tests behind environment variables so unit tests remain fast.

Suggested env names:

```bash
MSSQL_HOST=localhost
MSSQL_PORT=1433
MSSQL_DATABASE=halifax_test
MSSQL_USER=sa
MSSQL_PASSWORD='your-password'
API_KEY='dev-secret'
```
