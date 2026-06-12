/**
 * Database: CockroachDB  (Prisma `provider = "cockroachdb"`, driver adapter `@prisma/adapter-pg`)
 *
 * CockroachDB speaks the PostgreSQL wire protocol, so it uses the same `@prisma/adapter-pg`
 * driver as Postgres — only the schema `provider` and the connection string differ (Cockroach
 * listens on 26257 by default). Prefer `@default(sequence())` ids in your schema to keep them
 * small/ordered (its `autoincrement()` emits large `unique_rowid()` values).
 *
 *   DATABASE_URL="postgresql://root@localhost:26257/mydb?sslmode=disable" pnpm tsx examples/db-cockroachdb.ts
 */

import express from 'express'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  ApiKeyAuthStrategy,
  PrismaAdapter,
  createExpressCrudRouter,
  type ResourceDefinition
} from '../src/index.js'

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) })

const posts: ResourceDefinition = {
  routePrefix: 'posts',
  repository: new PrismaAdapter({ delegate: prisma.post }),
  fields: [{ name: 'id' }, { name: 'title' }, { name: 'content' }, { name: 'published' }]
}

const app = express()
app.use(express.json())
app.use(
  '/api/v1',
  createExpressCrudRouter([posts], {
    authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY ?? 'dev-secret')
  })
)
app.listen(Number(process.env.PORT ?? 3000))
