/**
 * Database: MariaDB  (Prisma `provider = "mysql"`, driver adapter `@prisma/adapter-mariadb`)
 *
 * Identical wiring to db-mysql.ts — MariaDB rides Prisma's `mysql` provider and the same driver
 * adapter. The connection string just points at your MariaDB server.
 *
 *   DATABASE_URL="mysql://user:pass@localhost:3306/mydb" pnpm tsx examples/db-mariadb.ts
 */

import express from 'express'
import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import {
  ApiKeyAuthStrategy,
  PrismaAdapter,
  createExpressCrudRouter,
  type ResourceDefinition
} from '../src/index.js'

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) })

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
