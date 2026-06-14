/**
 * Drizzle ORM adapter integration tests
 *
 * Uses SQLite in-memory via better-sqlite3 — no external database required.
 * These tests always run as part of the integration suite.
 *
 * Coverage:
 *   Suite 1: Full repository contract (CRUD, all query operators, logical
 *            connectives, tenant isolation) via the shared `runRepositoryContract`
 *            helper — same coverage as PrismaAdapter's direct tests.
 *   Suite 2: End-to-end HTTP layer through Express + createExpressCrudRouter
 *            (CRUD, field projection, 404/422 handling, query builder POST /query).
 */

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import express from 'express'
import request, { agent as supertestAgent } from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleAdapter } from '@/adapters/orm/drizzle/DrizzleAdapter.js'
import { createExpressCrudRouter } from '@/adapters/http/ExpressAdapter.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import type { ResourceDefinition } from '@/core/types.js'
import { SqlComparison, SqlOperator } from '@edium/halifax-types'
import { runRepositoryContract } from '../helpers/repositoryContract.js'

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * Test table mirrors the Prisma `Post` model used in prismaExpress.integration.test.ts.
 * `tenantId` is included so the shared contract can run tenant isolation tests.
 */
const postsTable = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull().default(''),
  content: text('content'),
  published: integer('published', { mode: 'boolean' }).notNull().default(false),
  tenantId: text('tenant_id')
})

type Post = {
  id: number
  title: string
  content: string | null
  published: boolean
  tenantId: string | null
}

// ─── DB factory ──────────────────────────────────────────────────────────────

function createInMemoryDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE posts (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      title    TEXT    NOT NULL DEFAULT '',
      content  TEXT,
      published INTEGER NOT NULL DEFAULT 0,
      tenant_id TEXT
    )
  `)
  return { db: drizzle(sqlite), sqlite }
}

// ─── Suite 1: Shared repository contract ─────────────────────────────────────

runRepositoryContract('DrizzleAdapter (SQLite in-memory)', () => {
  const { db, sqlite } = createInMemoryDb()
  const repo = new DrizzleAdapter<Post, Omit<Post, 'id'>, Partial<Post>>(db, postsTable)

  return {
    repo,
    cleanup: async () => {
      db.delete(postsTable).run()
    },
    teardown: async () => {
      sqlite.close()
    }
  }
})

// ─── Suite 2: HTTP layer via Express + DrizzleAdapter ─────────────────────────

const API_KEY = 'drizzle-test-key'

const POST_FIELDS: ResourceDefinition['fields'] = [
  { name: 'id', writable: false, filterable: true, sortable: true },
  { name: 'title', writable: true, filterable: true, sortable: true },
  { name: 'content', writable: true },
  { name: 'published', writable: true, filterable: true },
  { name: 'tenantId', writable: true }
]

describe('DrizzleAdapter + Express — HTTP layer', () => {
  let db: ReturnType<typeof drizzle>
  let sqlite: InstanceType<typeof Database>
  let app: express.Application
  let agent: ReturnType<typeof supertestAgent>

  beforeAll(() => {
    const conn = createInMemoryDb()
    db = conn.db
    sqlite = conn.sqlite

    const repo = new DrizzleAdapter<Post, Omit<Post, 'id'>, Partial<Post>>(db, postsTable)

    const resource: ResourceDefinition = {
      name: 'Post',
      routePrefix: 'posts',
      fields: POST_FIELDS,
      repository: repo as any
    }

    app = express()
    app.use(express.json())
    app.use('/api', createExpressCrudRouter([resource], { authStrategy: new ApiKeyAuthStrategy(API_KEY) }))

    agent = supertestAgent(app).set('x-api-key', API_KEY)
  })

  afterAll(() => {
    sqlite.close()
  })

  beforeEach(() => {
    db.delete(postsTable).run()
  })

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function seedPost(overrides: Partial<Omit<Post, 'id'>> = {}): Promise<Post> {
    const res = await agent
      .post('/api/posts')
      .send({ title: 'Test Post', published: false, content: null, ...overrides })
    return res.body as Post
  }

  // ── GET /posts ─────────────────────────────────────────────────────────────

  describe('GET /posts', () => {
    it('returns an empty list when there are no records', async () => {
      const res = await agent.get('/api/posts')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ count: 0, results: [] })
    })

    it('returns all records with their ids', async () => {
      await seedPost({ title: 'Alpha' })
      await seedPost({ title: 'Bravo' })
      const res = await agent.get('/api/posts')
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(2)
      const titles = res.body.results.map((r: Post) => r.title)
      expect(titles).toContain('Alpha')
      expect(titles).toContain('Bravo')
    })

    it('filters by query-string equality', async () => {
      await seedPost({ title: 'Published', published: true })
      await seedPost({ title: 'Draft', published: false })
      const res = await agent.get('/api/posts?published=true')
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(1)
      expect(res.body.results[0].title).toBe('Published')
    })

    it('respects limit and offset', async () => {
      for (let i = 1; i <= 5; i++) {
        await seedPost({ title: `Post ${i}` })
      }
      const res = await agent.get('/api/posts?limit=2&offset=2')
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(5) // total
      expect(res.body.results).toHaveLength(2) // page
    })

    it('sorts by field ascending', async () => {
      await seedPost({ title: 'Zed' })
      await seedPost({ title: 'Alpha' })
      const res = await agent.get('/api/posts?order=title')
      expect(res.status).toBe(200)
      expect(res.body.results[0].title).toBe('Alpha')
    })

    it('sorts by field descending', async () => {
      await seedPost({ title: 'Aardvark' })
      await seedPost({ title: 'Zebra' })
      const res = await agent.get('/api/posts?order=-title')
      expect(res.status).toBe(200)
      expect(res.body.results[0].title).toBe('Zebra')
    })
  })

  // ── GET /posts/:id ─────────────────────────────────────────────────────────

  describe('GET /posts/:id', () => {
    it('returns the post by id', async () => {
      const created = await seedPost({ title: 'Found' })
      const res = await agent.get(`/api/posts/${created.id}`)
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Found')
    })

    it('returns 404 for a missing id', async () => {
      const res = await agent.get('/api/posts/999999')
      expect(res.status).toBe(404)
    })
  })

  // ── POST /posts ────────────────────────────────────────────────────────────

  describe('POST /posts', () => {
    it('creates a post and returns 201 with the new record', async () => {
      const res = await agent.post('/api/posts').send({ title: 'New Post', published: true, content: 'hello' })
      expect(res.status).toBe(201)
      expect(res.body.id).toBeTruthy()
      expect(res.body.title).toBe('New Post')
      expect(res.body.content).toBe('hello')
    })

    it('returns 422 for an unknown field in the request body', async () => {
      const res = await agent.post('/api/posts').send({ title: 'T', unknownField: 'x' })
      expect(res.status).toBe(422)
    })

    it('returns 401 when the API key is missing', async () => {
      const res = await request(app).post('/api/posts').send({ title: 'Unauthed' })
      expect(res.status).toBe(401)
    })
  })

  // ── PATCH /posts/:id ───────────────────────────────────────────────────────

  describe('PATCH /posts/:id', () => {
    it('updates a post and returns 200 with the updated record', async () => {
      const created = await seedPost({ title: 'Old title' })
      const res = await agent.patch(`/api/posts/${created.id}`).send({ title: 'New title' })
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('New title')
    })

    it('returns 404 when patching a non-existent id', async () => {
      const res = await agent.patch('/api/posts/999999').send({ title: 'Ghost' })
      expect(res.status).toBe(404)
    })

    it('does not overwrite fields absent from the body', async () => {
      const created = await seedPost({ title: 'Keep', published: true })
      await agent.patch(`/api/posts/${created.id}`).send({ title: 'Changed' })
      const res = await agent.get(`/api/posts/${created.id}`)
      expect(res.body.published).toBe(true) // unchanged
    })
  })

  // ── PUT /posts/:id ─────────────────────────────────────────────────────────

  describe('PUT /posts/:id (upsert)', () => {
    it('creates the record when the id does not exist', async () => {
      const res = await agent
        .put('/api/posts/999998')
        .send({ title: 'Upserted', published: false, content: null, tenantId: null })
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Upserted')
    })

    it('updates the record when the id exists', async () => {
      const created = await seedPost({ title: 'Original' })
      const res = await agent
        .put(`/api/posts/${created.id}`)
        .send({ title: 'Replaced', published: true, content: null, tenantId: null })
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Replaced')
    })
  })

  // ── DELETE /posts/:id ──────────────────────────────────────────────────────

  describe('DELETE /posts/:id', () => {
    it('deletes the post and returns 200', async () => {
      const created = await seedPost()
      const res = await agent.delete(`/api/posts/${created.id}`)
      expect(res.status).toBe(200)
    })

    it('returns 404 for a missing id', async () => {
      const res = await agent.delete('/api/posts/999999')
      expect(res.status).toBe(404)
    })

    it('the record is gone after deletion', async () => {
      const created = await seedPost()
      await agent.delete(`/api/posts/${created.id}`)
      const res = await agent.get(`/api/posts/${created.id}`)
      expect(res.status).toBe(404)
    })
  })

  // ── POST /posts/query ──────────────────────────────────────────────────────

  describe('POST /posts/query (query builder)', () => {
    beforeEach(async () => {
      await seedPost({ title: 'Alpha', published: true, content: 'body' })
      await seedPost({ title: 'Bravo', published: false, content: null })
      await seedPost({ title: 'Charlie', published: true, content: null })
    })

    it('returns all records with no where clause', async () => {
      const res = await agent
        .post('/api/posts/query')
        .send({ fields: ['id', 'title', 'published'] })
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(3)
    })

    it('filters with Equal comparison', async () => {
      const res = await agent
        .post('/api/posts/query')
        .send({
          fields: ['id', 'title', 'published'],
          where: [{ field: 'published', comparison: SqlComparison.Equal, value1: false }]
        })
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(1)
      expect(res.body.results[0].title).toBe('Bravo')
    })

    it('filters with Contains comparison', async () => {
      const res = await agent
        .post('/api/posts/query')
        .send({
          fields: ['id', 'title'],
          where: [{ field: 'title', comparison: SqlComparison.Contains, value1: 'harl' }]
        })
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(1)
      expect(res.body.results[0].title).toBe('Charlie')
    })

    it('filters with IsNull comparison', async () => {
      const res = await agent
        .post('/api/posts/query')
        .send({
          fields: ['id', 'title', 'content'],
          where: [{ field: 'content', comparison: SqlComparison.IsNull }]
        })
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(2)
    })

    it('combines conditions with AND', async () => {
      const res = await agent
        .post('/api/posts/query')
        .send({
          fields: ['id', 'title', 'published'],
          where: [
            { field: 'published', comparison: SqlComparison.Equal, value1: true, operator: SqlOperator.And },
            { field: 'title', comparison: SqlComparison.Equal, value1: 'Charlie' }
          ]
        })
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(1)
      expect(res.body.results[0].title).toBe('Charlie')
    })

    it('combines conditions with OR', async () => {
      const res = await agent
        .post('/api/posts/query')
        .send({
          fields: ['id', 'title'],
          where: [
            { field: 'title', comparison: SqlComparison.Equal, value1: 'Alpha', operator: SqlOperator.Or },
            { field: 'title', comparison: SqlComparison.Equal, value1: 'Bravo' }
          ]
        })
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(2)
    })

    it('applies orderBy through the HTTP API', async () => {
      const res = await agent
        .post('/api/posts/query')
        .send({
          fields: ['id', 'title'],
          orderBy: [{ field: 'title', order: 'DESC' }]
        })
      expect(res.status).toBe(200)
      expect(res.body.results[0].title).toBe('Charlie')
    })

    it('applies limit and offset through the HTTP API', async () => {
      const res = await agent
        .post('/api/posts/query')
        .send({
          fields: ['id', 'title'],
          limit: 2,
          offset: 0,
          orderBy: [{ field: 'title', order: 'ASC' }]
        })
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(3) // total
      expect(res.body.results).toHaveLength(2) // page
      expect(res.body.results[0].title).toBe('Alpha')
    })
  })
})
