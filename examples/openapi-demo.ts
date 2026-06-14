/**
 * OpenAPI demo — no database required.
 *
 * Run:  npx tsx examples/openapi-demo.ts
 * Then: http://localhost:3000/api/v1/docs
 */

import express from 'express'
import {
  createExpressCrudRouter,
  type FieldDefinition,
  type ListResult,
  type Repository,
  type ResourceDefinition
} from '../src/index.js'

// ─── Minimal in-memory repository ─────────────────────────────────────────────

function makeRepo(fields: FieldDefinition[]): Repository {
  const store: Record<string, unknown>[] = []
  let nextId = 1
  return {
    fields,
    idField: 'id',
    capabilities: { supportsIncludes: false, supportsCreateManyReturn: true },
    async getOne(id) { return store.find((r) => (r as any).id == id) ?? null },
    async getMany(): Promise<ListResult<unknown>> { return { count: store.length, results: store } },
    async createOne(data) { const r = { id: nextId++, ...(data as object) }; store.push(r); return r },
    async createMany(data) { return Promise.all(data.map((d) => this.createOne!(d))) },
    async updateOne(id, data) {
      const r = store.find((r) => (r as any).id == id)
      if (!r) return null
      Object.assign(r, data)
      return r
    },
    async updateMany() { return { updated: [], results: [] } },
    async upsertOne(id, data) {
      const existing = await this.getOne!(id)
      if (existing) return this.updateOne!(id, data)
      const r = { id, ...(data as object) }; store.push(r); return r
    },
    async deleteOne(id) {
      const idx = store.findIndex((r) => (r as any).id == id)
      if (idx < 0) return null
      const [removed] = store.splice(idx, 1)
      return removed ?? null
    },
    async deleteMany() { return { deleted: [] } },
    async executeQuery() { return { count: store.length, results: store } }
  } as Repository
}

// ─── Resource definitions ──────────────────────────────────────────────────────

const posts: ResourceDefinition = {
  routePrefix: 'posts',
  name: 'Post',
  repository: makeRepo([
    { name: 'id', type: 'integer', writable: false },
    { name: 'title', type: 'string' },
    { name: 'content', type: 'string' },
    { name: 'published', type: 'boolean' },
    { name: 'viewCount', type: 'integer' },
    { name: 'createdAt', type: 'string', format: 'date-time', writable: false }
  ])
}

const users: ResourceDefinition = {
  routePrefix: 'users',
  name: 'User',
  repository: makeRepo([
    { name: 'id', type: 'integer', writable: false },
    { name: 'email', type: 'string', format: 'email' },
    { name: 'name', type: 'string' },
    { name: 'role', type: 'string' },
    { name: 'active', type: 'boolean' },
    { name: 'createdAt', type: 'string', format: 'date-time', writable: false }
  ]),
  permissions: { allowDeleteMany: false }
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())
app.use(
  '/api/v1',
  createExpressCrudRouter([posts, users], {
    openapi: {
      title: 'Halifax Demo API',
      version: '1.0.0',
      description: 'A live demo of Halifax auto-generated OpenAPI docs.',
      servers: [{ url: 'http://localhost:3000/api/v1', description: 'Local' }]
    }
  })
)

const port = 3000
app.listen(port, () => {
  console.log(`\nHalifax OpenAPI demo running`)
  console.log(`  Swagger UI  → http://localhost:${port}/api/v1/docs`)
  console.log(`  Raw spec    → http://localhost:${port}/api/v1/openapi.json\n`)
})
