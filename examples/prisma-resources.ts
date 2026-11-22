/**
 * Resources derived from the Prisma model: no `fields` arrays. This is the "preferred for Prisma" path in
 * README_REPO_ADAPTERS.md, and the example type-check compiles it against a real generated client, so
 * `Prisma.dmmf` stays assignable to Halifax's `ModelSchema`.
 *
 *   DATABASE_URL="postgresql://user:pass@localhost:5432/mydb" pnpm tsx examples/prisma-resources.ts
 */

import express from 'express'
import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  ApiKeyAuthStrategy,
  PrismaAdapter,
  createExpressCrudRouter,
  createPrismaResources,
  type ResourceDefinition
} from '../src/index.js'

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) })
const { models } = Prisma.dmmf.datamodel

// A resource per model, fields and relations derived from the DMMF.
const resources = createPrismaResources(prisma, models, {
  models: { SaleRecord: { exclude: true } }
})

// Or one resource from one model, overriding only what differs.
const authors: ResourceDefinition = {
  routePrefix: 'writers',
  repository: new PrismaAdapter({
    delegate: prisma.author,
    model: models.find((m) => m.name === 'Author')!
  }),
  fields: [{ name: 'email', writable: false }]
}

const app = express()
app.use(express.json())
app.use(
  '/api/v1',
  createExpressCrudRouter([...resources, authors], {
    authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY ?? 'dev-secret')
  })
)
app.listen(Number(process.env.PORT ?? 3000))
