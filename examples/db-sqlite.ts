/**
 * Database: SQLite  (Prisma `provider = "sqlite"`, driver adapter `@prisma/adapter-better-sqlite3`)
 *
 * Embedded — no server, no connection string. The better-sqlite3 adapter wants a filesystem
 * path (Prisma's URL form is `file:<path>`); pass the bare path.
 *
 *   pnpm tsx examples/db-sqlite.ts          # uses ./dev.db
 */

import express from 'express'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import {
  ApiKeyAuthStrategy,
  PrismaAdapter,
  createExpressCrudRouter,
  type ResourceDefinition
} from '../src/index.js'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.SQLITE_PATH ?? './dev.db' })
})

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
