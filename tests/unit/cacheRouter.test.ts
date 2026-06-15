import express from 'express'
import request from 'supertest'
import { describe, it, expect } from 'vitest'
import { createExpressCrudRouter } from '@/adapters/http/ExpressAdapter.js'
import { InMemoryCacheStore } from '@/core/cache/index.js'
import { wantsCacheBust } from '@/core/handlerUtils.js'
import type { ListResult, Repository, ResourceDefinition, HttpRequest } from '@/core/types.js'

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

  it('custom bustHeader busts the cache when the header is present with any value', async () => {
    // handlerUtils.ts line 197: return true for custom (non-cache-control) header with non-empty value
    const { repo, getManyCalls } = makeCountingRepo()
    const resource: ResourceDefinition = {
      name: 'Widget',
      routePrefix: 'widgets',
      fields: [
        { name: 'id', filterable: true },
        { name: 'name', writable: true }
      ],
      cache: { ttlSeconds: 0 },
      repository: repo
    }
    const app2 = express()
    app2.use(express.json())
    app2.use(
      '/api',
      createExpressCrudRouter([resource], {
        cache: { store: new InMemoryCacheStore(), bustHeader: 'x-bypass-cache' }
      })
    )
    await request(app2).get('/api/widgets')
    expect(getManyCalls()).toBe(1)
    // Custom header present with any value → bust
    await request(app2).get('/api/widgets').set('x-bypass-cache', '1')
    expect(getManyCalls()).toBe(2)
    // Subsequent normal read is served from the refreshed cache
    await request(app2).get('/api/widgets')
    expect(getManyCalls()).toBe(2)
  })
})

function makeReq(headers: Record<string, string>): HttpRequest {
  return { method: 'GET', params: {}, query: {}, body: null, headers, raw: null }
}

describe('wantsCacheBust', () => {
  it('returns false when the header is absent', () => {
    expect(wantsCacheBust(makeReq({}), 'cache-control')).toBe(false)
  })

  it('returns true for Cache-Control: no-cache', () => {
    expect(wantsCacheBust(makeReq({ 'cache-control': 'no-cache' }), 'cache-control')).toBe(true)
  })

  it('returns true for Cache-Control: no-store', () => {
    expect(wantsCacheBust(makeReq({ 'cache-control': 'no-store' }), 'cache-control')).toBe(true)
  })

  it('returns false for Cache-Control: max-age=0 (no no-cache/no-store directive)', () => {
    expect(wantsCacheBust(makeReq({ 'cache-control': 'max-age=0' }), 'cache-control')).toBe(false)
  })

  it('returns true for a custom header with a non-empty value (line 197)', () => {
    // handlerUtils.ts line 197: return true when header is NOT cache-control and value is non-empty
    expect(wantsCacheBust(makeReq({ 'x-bypass-cache': '1' }), 'x-bypass-cache')).toBe(true)
  })

  it('returns false for a custom header that is absent', () => {
    expect(wantsCacheBust(makeReq({}), 'x-bypass-cache')).toBe(false)
  })
})
