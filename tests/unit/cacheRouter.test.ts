import express from 'express'
import request from 'supertest'
import { describe, it, expect } from 'vitest'
import { createExpressCrudRouter } from '@/adapters/http/ExpressAdapter.js'
import { InMemoryCacheStore } from '@/core/cache/index.js'
import type { ListResult, Repository, ResourceDefinition } from '@/core/types.js'

type Widget = { id: number; name: string }

/** A repository that counts `getMany` calls so we can observe cache hits vs misses. */
function makeCountingRepo() {
  let getManyCalls = 0
  const records: Widget[] = [{ id: 1, name: 'one' }]
  const repo: Repository<Widget, Partial<Widget>, Partial<Widget>> = {
    async getMany(): Promise<ListResult<Widget>> {
      getManyCalls++
      return { count: records.length, results: [...records] }
    },
    async getOne(id) {
      return records.find((r) => r.id === Number(id)) ?? null
    },
    async createOne(data) {
      const r = { id: records.length + 1, name: '', ...data }
      records.push(r)
      return r
    },
    async createMany(data) {
      return data.map((d) => ({ id: records.length + 1, name: '', ...d }))
    },
    async updateOne() {
      return null
    },
    async deleteOne() {
      return false
    }
  }
  return { repo, getManyCalls: () => getManyCalls }
}

/**
 * Builds an Express app whose `widgets` resource caches with a never-expire TTL (0).
 * @returns The app plus a getter for the underlying `getMany` call count.
 */
function buildApp() {
  const { repo, getManyCalls } = makeCountingRepo()
  const resource: ResourceDefinition = {
    name: 'Widget',
    routePrefix: 'widgets',
    fields: [
      { name: 'id', filterable: true },
      { name: 'name', writable: true }
    ],
    cache: { ttlSeconds: 0 }, // 0 = never expire
    repository: repo
  }
  const app = express()
  app.use(express.json())
  app.use(
    '/api',
    createExpressCrudRouter([resource], { cache: { store: new InMemoryCacheStore() } })
  )
  return { app, getManyCalls }
}

describe('createExpressCrudRouter — caching', () => {
  it('serves a second identical read from cache (underlying hit once)', async () => {
    const { app, getManyCalls } = buildApp()
    await request(app).get('/api/widgets')
    await request(app).get('/api/widgets')
    expect(getManyCalls()).toBe(1)
  })

  it('never expires with ttlSeconds: 0', async () => {
    const { app, getManyCalls } = buildApp()
    for (let i = 0; i < 5; i++) await request(app).get('/api/widgets')
    expect(getManyCalls()).toBe(1)
  })

  it('Cache-Control: no-cache busts the cache and force-refreshes', async () => {
    const { app, getManyCalls } = buildApp()
    await request(app).get('/api/widgets')
    expect(getManyCalls()).toBe(1)
    await request(app).get('/api/widgets').set('Cache-Control', 'no-cache')
    expect(getManyCalls()).toBe(2)
    // The refreshed value is then served from cache again.
    await request(app).get('/api/widgets')
    expect(getManyCalls()).toBe(2)
  })

  it('a write invalidates cached reads', async () => {
    const { app, getManyCalls } = buildApp()
    await request(app).get('/api/widgets')
    await request(app).post('/api/widgets').send({ name: 'two' })
    await request(app).get('/api/widgets')
    expect(getManyCalls()).toBe(2)
  })
})
