import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiKeyAuthStrategy, PrismaAdapter, type ResourceDefinition } from '@/index.js'
import type { ContractApp } from './adapterContract.js'
import { connectIntegrationDb, idTypeName, missingId } from './integrationDb.js'

/** Shared API key used by every Prisma HTTP integration contract. */
export const PRISMA_API_KEY = 'test-secret'

const hasDb = !!process.env.DATABASE_URL

// Prisma types come from the generated test client. We use `any` here so these files
// compile before `pnpm test:integration:generate` has been run.
type AnyPrisma = any

/**
 * The `Post` resource shared by every framework's Prisma integration test. Mirrors the
 * resource used by the Express integration suite so all adapters are exercised identically.
 * @param repo - The Prisma-backed repository for the `posts` table.
 * @returns A `posts` {@link ResourceDefinition}.
 */
export function postResource(repo: PrismaAdapter): ResourceDefinition {
  return {
    name: 'Post',
    routePrefix: 'posts',
    fields: [
      { name: 'id', filterable: true, sortable: true },
      { name: 'title', filterable: true, sortable: true, writable: true },
      { name: 'content', writable: true },
      { name: 'published', filterable: true, writable: true },
      { name: 'authorId', filterable: true },
      { name: 'createdAt', sortable: true }
    ],
    relations: [{ name: 'author', includable: true }],
    repository: repo
  }
}

/**
 * Runs the full PrismaAdapter + HTTP CRUD integration contract against an adapter, over a
 * real PostgreSQL database. Skipped entirely when `DATABASE_URL` is not set.
 *
 * The Prisma client lifecycle (connect / disconnect / per-test cleanup) is owned here; the
 * caller only wires its framework's CRUD router/plugin around the supplied repository and
 * returns a supertest target + teardown.
 *
 * @param name - Display name for the suite (e.g. `'Fastify'`).
 * @param mount - Builds and starts the adapter's app around the given repository.
 *   Receives an {@link ApiKeyAuthStrategy} configured with {@link PRISMA_API_KEY}.
 */
export function runPrismaHttpContract(
  name: string,
  mount: (
    resources: ResourceDefinition[],
    authStrategy: ApiKeyAuthStrategy
  ) => Promise<ContractApp> | ContractApp
): void {
  describe.skipIf(!hasDb)(`${name} + Prisma — HTTP CRUD integration`, () => {
    let prisma: AnyPrisma
    let app: ContractApp
    const agent = () => request(app.target)
    const key = (req: request.Test) => req.set('x-api-key', PRISMA_API_KEY)

    beforeAll(async () => {
      prisma = await connectIntegrationDb()
      const repo = new PrismaAdapter({ delegate: prisma.post })
      app = await mount([postResource(repo)], new ApiKeyAuthStrategy(PRISMA_API_KEY))
    })

    afterAll(async () => {
      await app.close()
      await prisma.$disconnect()
    })

    beforeEach(async () => {
      await prisma.post.deleteMany()
    })

    it('GET /posts returns 401 without auth', async () => {
      expect((await agent().get('/api/posts')).status).toBe(401)
    })

    it('GET /posts returns 403 with a wrong API key', async () => {
      expect((await agent().get('/api/posts').set('x-api-key', 'wrong')).status).toBe(403)
    })

    it('POST /posts creates a record (201)', async () => {
      const res = await key(agent().post('/api/posts')).send({
        title: 'Via HTTP',
        published: false
      })
      expect(res.status).toBe(201)
      expect(res.body.title).toBe('Via HTTP')
      expect(res.body.id).toBeTypeOf(idTypeName())
    })

    it('POST /posts with an array creates multiple records (201)', async () => {
      const res = await key(agent().post('/api/posts')).send([
        { title: 'A', published: true },
        { title: 'B', published: true }
      ])
      expect(res.status).toBe(201)
    })

    it('GET /posts returns all records with a total count', async () => {
      await prisma.post.createMany({ data: [{ title: 'X' }, { title: 'Y' }] })
      const res = await key(agent().get('/api/posts'))
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(2)
      expect(res.body.results).toHaveLength(2)
    })

    it('GET /posts/:id returns one record', async () => {
      const post = await prisma.post.create({ data: { title: 'Single' } })
      const res = await key(agent().get(`/api/posts/${post.id}`))
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Single')
    })

    it('GET /posts/:id returns 404 for a missing id', async () => {
      expect((await key(agent().get(`/api/posts/${missingId()}`))).status).toBe(404)
    })

    it('GET /posts/:id returns 400 for a non-integer id', async () => {
      const res = await key(agent().get('/api/posts/abc'))
      expect(res.status).toBe(400)
      expect(res.body.errors[0].code).toBe('BAD_REQUEST')
    })

    it('PATCH /posts/:id updates a record', async () => {
      const post = await prisma.post.create({ data: { title: 'Before' } })
      const res = await key(agent().patch(`/api/posts/${post.id}`)).send({ title: 'After' })
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('After')
    })

    it('PATCH /posts/:id returns 404 for a missing id', async () => {
      const res = await key(agent().patch(`/api/posts/${missingId()}`)).send({ title: 'Ghost' })
      expect(res.status).toBe(404)
    })

    it('PUT /posts/:id creates a record via upsert (200)', async () => {
      const res = await key(agent().put(`/api/posts/${missingId()}`)).send({
        title: 'Upserted via HTTP',
        published: false
      })
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Upserted via HTTP')
    })

    it('DELETE /posts/:id removes the record', async () => {
      const post = await prisma.post.create({ data: { title: 'Bye' } })
      const res = await key(agent().delete(`/api/posts/${post.id}`))
      expect(res.body.deleted).toBe(true)
      expect((await key(agent().get(`/api/posts/${post.id}`))).status).toBe(404)
    })

    it('DELETE /posts/:id returns 404 for a missing id', async () => {
      expect((await key(agent().delete(`/api/posts/${missingId()}`))).status).toBe(404)
    })

    it('GET /posts with ?limit and ?offset returns the correct page', async () => {
      for (let i = 1; i <= 5; i++) await prisma.post.create({ data: { title: `P${i}` } })
      const res = await key(agent().get('/api/posts?limit=2&offset=2'))
      expect(res.status).toBe(200)
      expect(res.body.results).toHaveLength(2)
      expect(res.body.count).toBe(5)
    })

    it('GET /posts with ?title= filters by title', async () => {
      await prisma.post.createMany({ data: [{ title: 'FindMe' }, { title: 'Skip' }] })
      const res = await key(agent().get('/api/posts?title=FindMe'))
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(1)
      expect(res.body.results[0].title).toBe('FindMe')
    })

    it('POST /posts/query-builder returns matching results', async () => {
      await prisma.post.createMany({
        data: [
          { title: 'TypeScript guide', published: true },
          { title: 'Node.js guide', published: true },
          { title: 'Draft post', published: false }
        ]
      })
      const res = await key(agent().post('/api/posts/query')).send({
        fields: ['id', 'title'],
        where: [{ field: 'published', comparison: '=', value1: true }],
        orderBy: [{ field: 'id', order: 'ASC' }],
        limit: 10,
        offset: 0
      })
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(2)
      expect(res.body.results).toHaveLength(2)
    })

    it('returns 405 with an Allow header for an unsupported method', async () => {
      const res = await key(agent().put('/api/posts'))
      expect(res.status).toBe(405)
      expect(res.headers['allow']).toContain('GET')
    })
  })
}
