/**
 * Integration test: read-through caching backed by a real Redis, over a real database.
 *
 * Models the common "lookup table" scenario — a read-heavy, rarely-changing resource cached
 * with a never-expire TTL. Run with: pnpm test:integration. Requires both DATABASE_URL and
 * REDIS_URL; skipped when either is unset.
 */

import express from 'express'
import request from 'supertest'
import { createClient } from 'redis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ApiKeyAuthStrategy,
  PrismaAdapter,
  RedisCacheStore,
  createExpressCrudRouter,
  type ResourceDefinition
} from '@/index.js'
import { connectIntegrationDb } from '../helpers/integrationDb.js'

const API_KEY = 'test-secret'
const hasDb = !!process.env.DATABASE_URL
const hasRedis = !!process.env.REDIS_URL

type AnyPrisma = any

describe.skipIf(!hasDb || !hasRedis)('Read-through caching via Redis (lookup table)', () => {
  let prisma: AnyPrisma
  let redis: ReturnType<typeof createClient>
  let app: ReturnType<typeof express>

  beforeAll(async () => {
    prisma = await connectIntegrationDb()
    redis = createClient({ url: process.env.REDIS_URL! })
    await redis.connect()

    // A `posts` resource standing in for a lookup table: cached with ttlSeconds: 0 (never
    // expire) so reads are served from Redis until a write invalidates them.
    const postResource: ResourceDefinition = {
      name: 'Post',
      routePrefix: 'posts',
      fields: [
        { name: 'id', filterable: true, sortable: true },
        { name: 'title', filterable: true, writable: true },
        { name: 'published', filterable: true, writable: true }
      ],
      permissions: { allowReadMany: true, allowReadOne: true, allowCreate: true },
      cache: { ttlSeconds: 0 },
      repository: new PrismaAdapter({ delegate: prisma.post })
    }

    app = express()
    app.use(express.json())
    app.use(
      '/api',
      createExpressCrudRouter([postResource], {
        authStrategy: new ApiKeyAuthStrategy(API_KEY),
        cache: { store: new RedisCacheStore(redis as never, { keyPrefix: 'halifax-test:' }) }
      })
    )
  })

  afterAll(async () => {
    await redis.flushAll()
    await redis.quit()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.post.deleteMany()
    await redis.flushAll()
  })

  const get = (path: string) => request(app).get(path).set('x-api-key', API_KEY)

  it('serves the second read from Redis (and never expires)', async () => {
    await prisma.post.createMany({ data: [{ title: 'A' }, { title: 'B' }] })

    const first = await get('/api/posts')
    expect(first.body.count).toBe(2)

    // Delete the rows directly in the DB — a cache hit must still return the old data.
    await prisma.post.deleteMany()
    const cached = await get('/api/posts')
    expect(cached.body.count).toBe(2) // served from Redis, not the (now empty) DB
  })

  it('writes the cache key into Redis', async () => {
    await prisma.post.create({ data: { title: 'Only' } })
    await get('/api/posts')
    const keys = await redis.keys('halifax-test:Post:*')
    expect(keys.length).toBeGreaterThan(0)
  })

  it('Cache-Control: no-cache busts and returns fresh data', async () => {
    await prisma.post.createMany({ data: [{ title: 'A' }, { title: 'B' }] })
    await get('/api/posts') // populate cache
    await prisma.post.deleteMany() // empty the DB behind the cache

    const busted = await get('/api/posts').set('Cache-Control', 'no-cache')
    expect(busted.body.count).toBe(0) // bypassed Redis, read the empty DB

    // The bust refreshed the cache, so the next normal read also sees 0.
    const after = await get('/api/posts')
    expect(after.body.count).toBe(0)
  })

  it('a write invalidates the Redis cache', async () => {
    await prisma.post.create({ data: { title: 'A' } })
    expect((await get('/api/posts')).body.count).toBe(1)

    await request(app).post('/api/posts').set('x-api-key', API_KEY).send({ title: 'B' })
    expect((await get('/api/posts')).body.count).toBe(2) // invalidated → fresh count
  })
})
