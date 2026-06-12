/**
 * HTTP adapter: Fastify
 *
 * Same resources, same behaviour as the Express example — Fastify just mounts the CRUD layer
 * as a plugin (with a `prefix`) instead of a router. Fastify parses JSON bodies itself.
 *
 *   DATABASE_URL=postgresql://... API_KEY=dev-secret pnpm tsx examples/http-fastify.ts
 */

import Fastify from 'fastify'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { ApiKeyAuthStrategy, PrismaAdapter, type ResourceDefinition } from '../src/index.js'
import { createFastifyCrudPlugin } from '../src/adapters/http/FastifyAdapter.js'

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) })

const posts: ResourceDefinition = {
  routePrefix: 'posts',
  repository: new PrismaAdapter({ delegate: prisma.post }),
  fields: [{ name: 'id' }, { name: 'title' }, { name: 'content' }, { name: 'published' }]
}

const app = Fastify()
await app.register(
  createFastifyCrudPlugin([posts], {
    authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY ?? 'dev-secret')
  }),
  { prefix: '/api/v1' }
)

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port })
console.log(`Halifax (Fastify) listening on :${port}`)
