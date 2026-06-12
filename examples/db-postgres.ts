/**
 * Database: PostgreSQL  (Prisma `provider = "postgresql"`, driver adapter `@prisma/adapter-pg`)
 *
 * Only the Prisma client construction is engine-specific — the resource, router, and every
 * other Halifax concept are identical across databases. Compare with the other `db-*.ts` files.
 *
 *   DATABASE_URL="postgresql://user:pass@localhost:5432/mydb" pnpm tsx examples/db-postgres.ts
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
