# Using Halifax

This guide walks through setting up Halifax with Express, Prisma 7, and PostgreSQL.

> **Other adapters** — Fastify, Hyper Express, and Sequelize support are planned for future releases.

## Prerequisites

```bash
pnpm add @edium/halifax express @prisma/client
pnpm add -D prisma @types/express
```

## 1. Define your Prisma schema

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  Int?
  author    Author?  @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("posts")
}

model Author {
  id    Int    @id @default(autoincrement())
  name  String
  email String @unique
  posts Post[]

  @@map("authors")
}
```

```bash
pnpm exec prisma generate
pnpm exec prisma migrate dev --name init
```

## 2. Create the Prisma client

```ts
// src/db.ts
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
```

## 3. Create a repository adapter

```ts
import { PrismaRepositoryAdapter } from '@edium/halifax'
import type { Post, Prisma } from '@prisma/client'
import { prisma } from './db.js'

export const postRepository = new PrismaRepositoryAdapter<
  Post,
  Prisma.PostCreateInput,
  Prisma.PostUpdateInput
>({
  delegate: prisma.post as any, // cast needed — Prisma's generated types are narrower than the adapter interface
  client: prisma, // required for updateMany / deleteMany / executeQueryBuilder
  tableName: 'posts' // matches @@map in your schema
})
```

## 4. Choose an auth strategy

### Passport + JWT (recommended for production)

```ts
import passport from 'passport'
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt'
import { PassportJwtStrategy } from '@edium/halifax'

passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET
    },
    (payload, done) => done(null, payload)
  )
)

// Default mapUser reads: sub/id → userId, roles, permissions, full payload → claims
export const authStrategy = new PassportJwtStrategy({ passport })

// Custom payload shape
export const authStrategy = new PassportJwtStrategy({
  passport,
  mapUser: (user) => {
    const u = user as { userId: string; role: string }
    return { isAuthenticated: true, userId: u.userId, roles: [u.role] }
  }
})
```

### JWT claims (no Passport dependency)

```ts
import { JwtClaimsAuthStrategy } from '@edium/halifax'
import { verify } from 'jsonwebtoken'

export const authStrategy = new JwtClaimsAuthStrategy(async (token) => {
  const payload = verify(token, process.env.JWT_SECRET!) as Record<string, unknown>
  return {
    isAuthenticated: true,
    userId: payload.sub as string,
    roles: (payload.roles ?? []) as string[],
    permissions: (payload.permissions ?? []) as string[],
    claims: payload
  }
})
```

### API key (simple / internal services)

```ts
import { ApiKeyAuthStrategy } from '@edium/halifax'

export const authStrategy = new ApiKeyAuthStrategy(process.env.API_KEY ?? '')
```

## 5. Define a resource

```ts
import type { ResourceDefinition } from '@edium/halifax'
import { postRepository } from './repositories/post.js'

export const postResource: ResourceDefinition = {
  name: 'Post',
  routePrefix: 'posts',
  tableName: 'posts',
  fields: [
    { name: 'id', filterable: true, sortable: true },
    { name: 'title', filterable: true, sortable: true, writable: true },
    { name: 'content', writable: true },
    { name: 'published', filterable: true, writable: true },
    { name: 'authorId', filterable: true },
    { name: 'createdAt', sortable: true }
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

## 6. Wire up Express

```ts
// src/app.ts
import express from 'express'
import passport from 'passport'
import { createExpressCrudRouter } from '@edium/halifax'
import { authStrategy } from './auth.js'
import { postResource } from './resources/post.js'

export function createApp() {
  const app = express()
  app.use(express.json())
  app.use(passport.initialize())
  app.use('/api/v1', createExpressCrudRouter([postResource], { authStrategy }))
  return app
}
```

## 7. Generated routes

```
GET    /api/v1/posts               list with pagination + filters
GET    /api/v1/posts/:id           get one (supports ?fields= and ?include=)
POST   /api/v1/posts               create one (or array for batch)
PATCH  /api/v1/posts/:id           update one
DELETE /api/v1/posts/:id           delete one
POST   /api/v1/posts/query-builder advanced SQL query (if allowReadManyWithQueryBuilder)
```

### Query-string filtering

```
GET /api/v1/posts?where[published]=true&limit=10&offset=0&orderBy[0][field]=createdAt&orderBy[0][direction]=desc
```

### Query builder payload

```json
POST /api/v1/posts/query-builder
{
  "tableName": "posts",
  "fields": ["id", "title", "published"],
  "where": [
    { "field": "published", "comparison": "=", "value1": true },
    { "field": "title",     "comparison": "LIKE", "value1": "%typescript%" }
  ],
  "orderBy": [{ "field": "createdAt", "order": "DESC" }],
  "limit": 25,
  "offset": 0
}
```

## 8. Environment variables

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/myapp"
JWT_SECRET="your-secret-key"
# or
API_KEY="your-api-key"
```