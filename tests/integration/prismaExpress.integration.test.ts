/**
 * Full-stack integration tests: PrismaAdapter + Express + PostgreSQL
 *
 * Run with: pnpm test:integration
 * Requires DATABASE_URL in .env.test (loaded automatically via dotenv-cli).
 * All tests are skipped when DATABASE_URL is not set.
 */

import { connectIntegrationDb, idTypeName, missingId } from '../helpers/integrationDb.js'
import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ApiKeyAuthStrategy,
  JwtClaimsAuthStrategy,
  PrismaAdapter,
  createExpressCrudRouter,
  type IQueryOptions,
  type ResourceDefinition
} from '@/index.js'

const API_KEY = 'test-secret'
const hasDb = !!process.env.DATABASE_URL

// ---------------------------------------------------------------------------
// Lightweight entity types that match the Prisma-generated Post and Author
// shapes used in this test file. Typed here so we can avoid `any` while still
// compiling before `pnpm test:integration:generate` has been run.
// ---------------------------------------------------------------------------

type Post = {
  id: number | string
  title: string
  content?: string | null
  published?: boolean
  authorId?: number | string | null
  createdAt?: unknown
  author?: Author | null
}

type Author = {
  id: number | string
  name: string
  email: string
}

type PostListBody = { count: number; results: Post[] }
type PostErrorBody = { errors: Array<{ code: string; message: string }> }
type DeleteBody = { deleted: boolean }

/** Typed view of the Prisma client returned by `connectIntegrationDb()`. */
type PrismaClient = Awaited<ReturnType<typeof connectIntegrationDb>> & {
  post: {
    deleteMany(args?: unknown): Promise<{ count: number }>
    createMany(args: { data: unknown[] | unknown }): Promise<{ count: number }>
    create(args: { data: unknown }): Promise<Post>
    findUnique(args: { where: unknown }): Promise<Post | null>
    findMany(args?: unknown): Promise<Post[]>
    count(args?: unknown): Promise<number>
    update(args: unknown): Promise<Post>
    delete(args: unknown): Promise<unknown>
  }
  author: {
    deleteMany(args?: unknown): Promise<{ count: number }>
    create(args: { data: unknown }): Promise<Author>
  }
}

// ---------------------------------------------------------------------------
// Shared app factory
// ---------------------------------------------------------------------------

function buildPostApp(repo: PrismaAdapter) {
  const postResource: ResourceDefinition = {
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

  const app = express()
  app.use(express.json())
  app.use(
    '/api',
    createExpressCrudRouter([postResource], { authStrategy: new ApiKeyAuthStrategy(API_KEY) })
  )
  return app
}

// ---------------------------------------------------------------------------
// Suite 1: PrismaAdapter — direct (no HTTP)
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)('PrismaAdapter — direct', () => {
  let prisma: PrismaClient
  let repo: PrismaAdapter

  beforeAll(async () => {
    prisma = (await connectIntegrationDb()) as PrismaClient
    await prisma.$connect()
    repo = new PrismaAdapter({
      delegate: prisma.post
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.post.deleteMany()
    await prisma.author.deleteMany()
  })

  it('createOne returns the created record', async () => {
    const post = (await repo.createOne({ title: 'Hello', published: false })) as Post
    expect(post.id).toBeTypeOf(idTypeName())
    expect(post.title).toBe('Hello')
  })

  it('createMany inserts all records', async () => {
    await repo.createMany([
      { title: 'A', published: true },
      { title: 'B', published: false }
    ])
    const { count } = await repo.getMany()
    expect(count).toBe(2)
  })

  it('getOne returns null for a missing id', async () => {
    expect(await repo.getOne(missingId())).toBeNull()
  })

  it('getOne returns the record by id', async () => {
    const created = (await repo.createOne({ title: 'Find me', published: false })) as Post
    const found = (await repo.getOne(created.id)) as Post | null
    expect(found?.title).toBe('Find me')
  })

  it('getOne with fields returns only requested columns', async () => {
    const created = (await repo.createOne({
      title: 'Sparse',
      content: 'body',
      published: false
    })) as Post
    const found = (await repo.getOne(created.id, { fields: ['id', 'title'] })) as Post | null
    expect(found?.id).toBeDefined()
    expect(found?.title).toBeDefined()
    expect(found?.content).toBeUndefined()
  })

  it('getOne with include loads the relation', async () => {
    const author = await prisma.author.create({ data: { name: 'Ada', email: 'ada@example.com' } })
    const created = (await repo.createOne({
      title: 'With author',
      authorId: author.id,
      published: true
    })) as Post
    const found = (await repo.getOne(created.id, { include: ['author'] })) as Post | null
    expect(found?.author?.name).toBe('Ada')
  })

  it('getMany returns count and results', async () => {
    await repo.createMany([
      { title: 'P1', published: true },
      { title: 'P2', published: true },
      { title: 'P3', published: false }
    ])
    const { count, results } = await repo.getMany()
    expect(count).toBe(3)
    expect(results).toHaveLength(3)
  })

  it('getMany respects limit and offset', async () => {
    for (let i = 1; i <= 5; i++) await repo.createOne({ title: `Post ${i}`, published: true })
    const { results } = await repo.getMany({ limit: 2, offset: 2 })
    expect(results).toHaveLength(2)
  })

  it('getMany filters with a Prisma where clause', async () => {
    await repo.createMany([
      { title: 'Draft', published: false },
      { title: 'Live', published: true }
    ])
    const { count } = await repo.getMany({ where: { published: true } })
    expect(count).toBe(1)
  })

  it('getMany sorts by field', async () => {
    await repo.createMany([
      { title: 'Bravo', published: true },
      { title: 'Alpha', published: true }
    ])
    const { results } = await repo.getMany({ orderBy: [{ field: 'title', direction: 'asc' }] })
    expect((results[0] as Post)?.title).toBe('Alpha')
    expect((results[1] as Post)?.title).toBe('Bravo')
  })

  it('updateOne returns the updated record', async () => {
    const created = (await repo.createOne({ title: 'Old', published: false })) as Post
    const updated = (await repo.updateOne(created.id, { title: 'New' })) as Post | null
    expect(updated?.title).toBe('New')
  })

  it('updateOne returns null for a missing id', async () => {
    expect(await repo.updateOne(missingId(), { title: 'Ghost' })).toBeNull()
  })

  it('deleteOne removes the record and returns true', async () => {
    const created = (await repo.createOne({ title: 'Delete me', published: false })) as Post
    expect(await repo.deleteOne(created.id)).toBe(true)
    expect(await repo.getOne(created.id)).toBeNull()
  })

  it('deleteOne returns false for a missing id', async () => {
    expect(await repo.deleteOne(missingId())).toBe(false)
  })

  it('upsertOne creates a record when absent', async () => {
    // The key is supplied via the first arg (the `where`); it is intentionally NOT repeated
    // in the payload. Restating an auto-managed PK in the create body is rejected by
    // identity-column engines (SQL Server) and ObjectId keys (MongoDB), and is redundant
    // everywhere else.
    const post = (await repo.upsertOne!(missingId(), {
      title: 'Upserted',
      published: false
    })) as Post
    expect(post.title).toBe('Upserted')
  })

  it('executeQuery runs raw SQL and returns count + results', async () => {
    await repo.createMany([
      { title: 'QB Alpha', published: true },
      { title: 'QB Beta', published: true }
    ])
    const result = await repo.executeQuery!({
      fields: ['id', 'title'],
      where: [{ field: 'published', comparison: '=', value1: true }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(result.count).toBe(2)
    expect(result.results).toHaveLength(2)
  })

  it('upsertOne updates a record that already exists', async () => {
    const post = (await repo.createOne({ title: 'Original', published: false })) as Post
    const updated = (await repo.upsertOne!(post.id, {
      title: 'Updated via upsert',
      published: true
    })) as Post
    expect(updated.title).toBe('Updated via upsert')
    expect(updated.published).toBe(true)
  })

  it('getMany returns {count: 0, results: []} when no records exist', async () => {
    const { count, results } = await repo.getMany()
    expect(count).toBe(0)
    expect(results).toHaveLength(0)
  })

  it('executeQuery with no where clause returns all records', async () => {
    await repo.createMany([
      { title: 'X', published: true },
      { title: 'Y', published: false }
    ])
    const result = await repo.executeQuery!({
      fields: ['id', 'title'],
      limit: 100,
      offset: 0
    } satisfies IQueryOptions)
    expect(result.count).toBe(2)
    expect(result.results).toHaveLength(2)
  })

  it('executeQuery with multiple filters returns the intersection', async () => {
    await repo.createMany([
      { title: 'Long Published', published: true },
      { title: 'Short Published', published: true },
      { title: 'Draft', published: false }
    ])
    const result = await repo.executeQuery!({
      fields: ['id', 'title'],
      where: [
        { field: 'published', comparison: '=', value1: true, operator: 'AND' },
        { field: 'title', comparison: 'LIKE', value1: '%Published' }
      ],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(result.count).toBe(2)
  })

  it('updateMany updates matching records and returns their IDs', async () => {
    await repo.createMany([
      { title: 'Draft A', published: false },
      { title: 'Draft B', published: false },
      { title: 'Live C', published: true }
    ])
    const result = await repo.updateMany!(
      {
        where: [{ field: 'published', comparison: '=', value1: false }]
      } satisfies IQueryOptions,
      { published: true } as Record<string, unknown>
    )
    expect(result.updated).toHaveLength(2)
    const { count } = await repo.getMany({ where: { published: false } })
    expect(count).toBe(0)
  })

  it('deleteMany removes matching records and returns their IDs', async () => {
    await repo.createMany([
      { title: 'Keep', published: true },
      { title: 'Del A', published: false },
      { title: 'Del B', published: false }
    ])
    const result = await repo.deleteMany!({
      where: [{ field: 'published', comparison: '=', value1: false }]
    } satisfies IQueryOptions)
    expect(result.deleted).toHaveLength(2)
    const { count } = await repo.getMany()
    expect(count).toBe(1)
  })

  it('executeQuery runs without a client (delegate-only, no raw SQL)', async () => {
    await repo.createMany([
      { title: 'NoClient A', published: true },
      { title: 'NoClient B', published: false }
    ])
    const repoNoClient = new PrismaAdapter({ delegate: prisma.post })
    const result = await repoNoClient.executeQuery!({
      where: [{ field: 'published', comparison: '=', value1: true }]
    } satisfies IQueryOptions)
    expect(result.count).toBe(1)
    expect(result.results).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Suite 2: Express CRUD routes — full HTTP layer
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)('Express CRUD routes — HTTP layer', () => {
  let prisma: PrismaClient
  let app: ReturnType<typeof express>

  beforeAll(async () => {
    prisma = (await connectIntegrationDb()) as PrismaClient
    await prisma.$connect()
    app = buildPostApp(new PrismaAdapter({ delegate: prisma.post }))
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.post.deleteMany()
  })

  it('GET /posts returns 401 without auth', async () => {
    expect((await request(app).get('/api/posts')).status).toBe(401)
  })

  it('POST /posts creates a record', async () => {
    const res = await request(app)
      .post('/api/posts')
      .set('x-api-key', API_KEY)
      .send({ title: 'Via HTTP', published: false })
    expect(res.status).toBe(201)
    const body = res.body as Post
    expect(body.title).toBe('Via HTTP')
    expect(body.id).toBeTypeOf(idTypeName())
  })

  it('POST /posts with an array creates multiple records', async () => {
    const res = await request(app)
      .post('/api/posts')
      .set('x-api-key', API_KEY)
      .send([
        { title: 'A', published: true },
        { title: 'B', published: true }
      ])
    expect(res.status).toBe(201)
  })

  it('GET /posts returns all records with a total count', async () => {
    await prisma.post.createMany({ data: [{ title: 'X' }, { title: 'Y' }] })
    const res = await request(app).get('/api/posts').set('x-api-key', API_KEY)
    expect(res.status).toBe(200)
    const body = res.body as PostListBody
    expect(body.count).toBe(2)
    expect(body.results).toHaveLength(2)
  })

  it('GET /posts/:id returns one record', async () => {
    const post = await prisma.post.create({ data: { title: 'Single' } })
    const res = await request(app).get(`/api/posts/${post.id}`).set('x-api-key', API_KEY)
    expect(res.status).toBe(200)
    expect((res.body as Post).title).toBe('Single')
  })

  it('GET /posts/:id returns 404 for a missing id', async () => {
    expect(
      (await request(app).get(`/api/posts/${missingId()}`).set('x-api-key', API_KEY)).status
    ).toBe(404)
  })

  it('PATCH /posts/:id updates a record', async () => {
    const post = await prisma.post.create({ data: { title: 'Before' } })
    const res = await request(app)
      .patch(`/api/posts/${post.id}`)
      .set('x-api-key', API_KEY)
      .send({ title: 'After' })
    expect(res.status).toBe(200)
    expect((res.body as Post).title).toBe('After')
  })

  it('PATCH /posts/:id returns 404 for a missing id', async () => {
    const res = await request(app)
      .patch(`/api/posts/${missingId()}`)
      .set('x-api-key', API_KEY)
      .send({ title: 'Ghost' })
    expect(res.status).toBe(404)
  })

  it('DELETE /posts/:id removes the record', async () => {
    const post = await prisma.post.create({ data: { title: 'Bye' } })
    expect(
      ((await request(app).delete(`/api/posts/${post.id}`).set('x-api-key', API_KEY)).body as DeleteBody).deleted
    ).toBe(true)
    expect((await request(app).get(`/api/posts/${post.id}`).set('x-api-key', API_KEY)).status).toBe(
      404
    )
  })

  it('DELETE /posts/:id returns 404 for a missing id', async () => {
    expect(
      (await request(app).delete(`/api/posts/${missingId()}`).set('x-api-key', API_KEY)).status
    ).toBe(404)
  })

  it('POST /posts/query-builder returns matching results', async () => {
    await prisma.post.createMany({
      data: [
        { title: 'TypeScript guide', published: true },
        { title: 'Node.js guide', published: true },
        { title: 'Draft post', published: false }
      ]
    })
    const res = await request(app)
      .post('/api/posts/query')
      .set('x-api-key', API_KEY)
      .send({
        fields: ['id', 'title'],
        where: [{ field: 'published', comparison: '=', value1: true }],
        orderBy: [{ field: 'id', order: 'ASC' }],
        limit: 10,
        offset: 0
      })
    expect(res.status).toBe(200)
    const body = res.body as PostListBody
    expect(body.count).toBe(2)
    expect(body.results).toHaveLength(2)
  })

  it('POST /posts/query-builder with no where clause returns all records', async () => {
    await prisma.post.createMany({ data: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] })
    const res = await request(app)
      .post('/api/posts/query')
      .set('x-api-key', API_KEY)
      .send({ fields: ['id', 'title'], limit: 50, offset: 0 })
    expect(res.status).toBe(200)
    expect((res.body as PostListBody).count).toBe(3)
  })

  it('GET /posts/:id returns 400 for a non-integer id', async () => {
    const res = await request(app).get('/api/posts/abc').set('x-api-key', API_KEY)
    expect(res.status).toBe(400)
    expect((res.body as PostErrorBody).errors[0].code).toBe('BAD_REQUEST')
  })

  it('GET /posts with wrong API key returns 403', async () => {
    expect((await request(app).get('/api/posts').set('x-api-key', 'wrong')).status).toBe(403)
  })

  it('GET /posts with ?limit and ?offset returns the correct page', async () => {
    for (let i = 1; i <= 5; i++) await prisma.post.create({ data: { title: `P${i}` } })
    const res = await request(app).get('/api/posts?limit=2&offset=2').set('x-api-key', API_KEY)
    expect(res.status).toBe(200)
    const body = res.body as PostListBody
    expect(body.results).toHaveLength(2)
    expect(body.count).toBe(5)
  })

  it('GET /posts with ?title= filters by title', async () => {
    await prisma.post.createMany({
      data: [{ title: 'FindMe' }, { title: 'Skip' }]
    })
    const res = await request(app).get('/api/posts?title=FindMe').set('x-api-key', API_KEY)
    expect(res.status).toBe(200)
    const body = res.body as PostListBody
    expect(body.count).toBe(1)
    expect(body.results[0].title).toBe('FindMe')
  })

  it('PUT /posts/:id creates a record via upsert (returns 200)', async () => {
    const res = await request(app)
      .put(`/api/posts/${missingId()}`)
      .set('x-api-key', API_KEY)
      .send({ title: 'Upserted via HTTP', published: false })
    expect(res.status).toBe(200)
    expect((res.body as Post).title).toBe('Upserted via HTTP')
  })

  it('error response body has { errors: [{ code, message }] } shape', async () => {
    const res = await request(app).get('/api/posts/0').set('x-api-key', API_KEY)
    expect(res.status).toBe(400)
    const errBody = res.body as PostErrorBody
    expect(errBody).toHaveProperty('errors')
    expect(Array.isArray(errBody.errors)).toBe(true)
    expect(errBody.errors[0]).toHaveProperty('code', 'BAD_REQUEST')
    expect(errBody.errors[0]).toHaveProperty('message')
  })
})

// ---------------------------------------------------------------------------
// Suite 3: JwtClaimsAuthStrategy — requiredPermissions enforcement
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)('JwtClaimsAuthStrategy — permission enforcement', () => {
  let prisma: PrismaClient
  let app: ReturnType<typeof express>

  function makeToken(payload: Record<string, unknown>) {
    return Buffer.from(JSON.stringify(payload)).toString('base64')
  }

  beforeAll(async () => {
    prisma = (await connectIntegrationDb()) as PrismaClient
    await prisma.$connect()

    const repo = new PrismaAdapter({ delegate: prisma.post })

    const postResource: ResourceDefinition = {
      name: 'Post',
      routePrefix: 'posts',
      fields: [{ name: 'id' }, { name: 'title', writable: true }],
      requiredPermissions: { create: ['posts.write'] },
      repository: repo
    }

    app = express()
    app.use(express.json())
    app.use(
      '/api',
      createExpressCrudRouter([postResource], {
        authStrategy: new JwtClaimsAuthStrategy((token) => {
          // Test-only token: base64-encoded JSON payload
          const payload = JSON.parse(Buffer.from(token, 'base64').toString()) as Record<
            string,
            unknown
          >
          return {
            isAuthenticated: true,
            userId: payload.sub as string,
            roles: (payload.roles ?? []) as string[],
            permissions: (payload.permissions ?? []) as string[]
          }
        })
      })
    )
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.post.deleteMany()
  })

  it('GET /posts succeeds with any valid token (no requiredPermissions on readMany)', async () => {
    const res = await request(app)
      .get('/api/posts')
      .set('Authorization', `Bearer ${makeToken({ sub: 'u1' })}`)
    expect(res.status).toBe(200)
  })

  it('POST /posts is forbidden without the required permission', async () => {
    const res = await request(app)
      .post('/api/posts')
      .set('Authorization', `Bearer ${makeToken({ sub: 'u1', permissions: [] })}`)
      .send({ title: 'Nope' })
    expect(res.status).toBe(403)
  })

  it('POST /posts succeeds with the required permission', async () => {
    const res = await request(app)
      .post('/api/posts')
      .set('Authorization', `Bearer ${makeToken({ sub: 'u1', permissions: ['posts.write'] })}`)
      .send({ title: 'Allowed' })
    expect(res.status).toBe(201)
  })

  it('returns 401 when Authorization header is missing', async () => {
    expect((await request(app).post('/api/posts').send({ title: 'Anon' })).status).toBe(401)
  })

  it('returns 401 when Authorization uses a non-Bearer scheme', async () => {
    const res = await request(app).get('/api/posts').set('Authorization', 'Basic dXNlcjpwYXNz')
    expect(res.status).toBe(401)
  })

  it('POST /posts succeeds when user satisfies requiredPermissions via role', async () => {
    const res = await request(app)
      .post('/api/posts')
      .set('Authorization', `Bearer ${makeToken({ sub: 'u1', roles: ['posts.write'] })}`)
      .send({ title: 'Via role' })
    expect(res.status).toBe(201)
  })
})
