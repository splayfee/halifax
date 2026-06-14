/**
 * HTTP adapter: Express (4 or 5)
 *
 * The canonical example. The other `http-*.ts` files show the same API on a different
 * framework — only the import path and the mount call change. Run:
 *
 *   DATABASE_URL=postgresql://... API_KEY=dev-secret pnpm dev
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

// MINIMUM resource: only `routePrefix`, `repository`, and `fields` are required. Every field is
// filterable / sortable / selectable / writable by default (the primary key is never writable),
// so you list a flag only to turn it OFF.
const posts: ResourceDefinition = {
  routePrefix: 'posts',
  repository: new PrismaAdapter({ delegate: prisma.post }),
  fields: [{ name: 'id' }, { name: 'title' }, { name: 'content' }, { name: 'published' }]
}

// ── VERBOSE MODE (the same resource with every optional knob shown + its default) ───────────
// Nothing here is required; uncomment to see what the minimal form above is defaulting to.
//
// const postsVerbose: ResourceDefinition = {
//   routePrefix: 'posts',
//   repository: new PrismaAdapter({ delegate: prisma.post }),
//   name: 'Post',                              // default: title-cased routePrefix ('posts' → 'Posts')
//   fields: [
//     { name: 'id', filterable: true, sortable: true, selectable: true, writable: false },
//     { name: 'title', filterable: true, sortable: true, selectable: true, writable: true },
//     { name: 'content', writable: true },
//     { name: 'published', filterable: true, writable: true }
//   ],
//   relations: [{ name: 'author', includable: true }], // default: includable when listed
//   permissions: { allowDeleteMany: false },   // default: all enabled — list only what to DISABLE
//   requiredPermissions: { create: ['posts.create'] },
//   defaultLimit: 5000,                        // default: 5000   (0 = return all rows when ?limit= omitted)
//   maxLimit: 5000,                            // default: 5000   (0 = no cap; set both to 0 to disable pagination)
//   cache: { ttlSeconds: 30 }                  // default: caching off
// }

const app = express()
app.use(express.json())
app.use(
  '/api/v1',
  createExpressCrudRouter([posts], {
    authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY ?? 'dev-secret'),
    // Enable OpenAPI docs — zero manual annotation needed for Prisma resources.
    // Visit http://localhost:3000/api/v1/docs for Swagger UI.
    // Visit http://localhost:3000/api/v1/openapi.json for the raw spec.
    openapi: {
      title: 'Halifax Example API',
      version: '1.0.0',
      servers: [
        { url: `http://localhost:${process.env.PORT ?? 3000}/api/v1`, description: 'Local dev' }
      ]
    }
  })
)

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => {
  console.log(`Halifax (Express) listening on :${port}`)
  console.log(`  API docs → http://localhost:${port}/api/v1/docs`)
})
