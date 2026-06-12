/**
 * HTTP adapter: HyperExpress (high-performance, uWebSockets.js)
 *
 * Same resources and behaviour as the Express example; the adapter downloads + parses the JSON
 * body for you, so no body-parser middleware is needed.
 *
 *   DATABASE_URL=postgresql://... API_KEY=dev-secret pnpm tsx examples/http-hyper-express.ts
 */

import HyperExpress from 'hyper-express'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { ApiKeyAuthStrategy, PrismaAdapter, type ResourceDefinition } from '../src/index.js'
import { createHyperExpressCrudRouter } from '../src/adapters/http/HyperExpressAdapter.js'

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) })

const posts: ResourceDefinition = {
  routePrefix: 'posts',
  repository: new PrismaAdapter({ delegate: prisma.post }),
  fields: [{ name: 'id' }, { name: 'title' }, { name: 'content' }, { name: 'published' }]
}

const server = new HyperExpress.Server()
server.use(
  '/api/v1',
  createHyperExpressCrudRouter([posts], {
    authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY ?? 'dev-secret')
  })
)

const port = Number(process.env.PORT ?? 3000)
await server.listen(port)
console.log(`Halifax (HyperExpress) listening on :${port}`)
