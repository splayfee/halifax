/**
 * HTTP adapter: Ultimate Express (drop-in Express API on uWebSockets.js)
 *
 * Identical to the Express example — only the framework import changes.
 *
 *   DATABASE_URL=postgresql://... API_KEY=dev-secret pnpm tsx examples/http-ultimate-express.ts
 */

import express from 'ultimate-express'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { ApiKeyAuthStrategy, PrismaAdapter, type ResourceDefinition } from '../src/index.js'
import { createUltimateExpressCrudRouter } from '../src/adapters/http/UltimateExpressAdapter.js'

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
  createUltimateExpressCrudRouter([posts], {
    authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY ?? 'dev-secret')
  })
)

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => console.log(`Halifax (Ultimate Express) listening on :${port}`))
