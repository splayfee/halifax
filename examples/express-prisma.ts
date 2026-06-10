/**
 * Halifax dev server — Express + Prisma + PostgreSQL
 *
 * Prerequisites:
 *   DATABASE_URL=postgresql://... pnpm exec prisma migrate dev
 *
 * Run:
 *   DATABASE_URL=postgresql://... API_KEY=dev-secret tsx examples/express-prisma.ts
 */

import express from 'express'
import { PrismaClient } from '@prisma/client'
import {
  ApiKeyAuthStrategy,
  PrismaRepositoryAdapter,
  createExpressCrudRouter,
  type ResourceDefinition
} from '../src/index.js'

const prisma = new PrismaClient()

const posts: ResourceDefinition = {
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
  repository: new PrismaRepositoryAdapter({
    delegate: prisma.post as any,
    client: prisma,
    tableName: 'posts'
  })
}

const app = express()
app.use(express.json())
app.use(
  '/api/v1',
  createExpressCrudRouter([posts], {
    authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY ?? 'dev-secret')
  })
)

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => {
  console.log(`Halifax Express dev server listening on port ${port}`)
})
