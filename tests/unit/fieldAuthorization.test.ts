import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createExpressCrudRouter } from '@/adapters/http/ExpressAdapter.js'
import type { AuthContext, AuthStrategy } from '@/auth/AuthStrategy.js'
import type { AuthorizeParams } from '@/auth/AuthStrategy.js'
import type { HttpRequest } from '@/core/types.js'
import type { FieldDefinition, ListResult, Repository, ResourceDefinition } from '@/core/types.js'

type Article = { id: number; title: string; draft: boolean; internalNotes: string }

const SEED: Article[] = [{ id: 1, title: 'Hello', draft: true, internalNotes: 'secret' }]

function makeRepo(seed: Article[] = structuredClone(SEED)): Repository<Article> {
  const records = [...seed]
  return {
    async getOne(id) {
      return records.find((r) => r.id === Number(id)) ?? null
    },
    async getMany(): Promise<ListResult<Article>> {
      return { count: records.length, results: [...records] }
    },
    async createOne(data) {
      const r = { id: records.length + 1, ...data } as Article
      records.push(r)
      return r
    },
    async createMany(data) {
      const rs = data.map((d, i) => ({ id: records.length + i + 1, ...d }) as Article)
      records.push(...rs)
      return rs
    },
    async updateOne(id, data) {
      const r = records.find((x) => x.id === Number(id))
      if (!r) return null
      Object.assign(r, data)
      return r
    },
    async upsertOne(id, data) {
      const existing = records.find((x) => x.id === Number(id))
      if (existing) {
        Object.assign(existing, data)
        return existing
      }
      const r = { id: Number(id), ...data } as Article
      records.push(r)
      return r
    },
    async deleteOne(id) {
      const idx = records.findIndex((r) => r.id === Number(id))
      if (idx === -1) return false
      records.splice(idx, 1)
      return true
    }
  }
}

/** Auth strategy that returns a fixed context passed at construction. */
class FixedAuthStrategy implements AuthStrategy {
  constructor(private readonly ctx: AuthContext) {}
  authenticate(_req: HttpRequest): AuthContext {
    return this.ctx
  }
}

/** Auth strategy that extracts roles from a custom request header (for test flexibility). */
class HeaderRoleStrategy implements AuthStrategy {
  authenticate(req: HttpRequest): AuthContext {
    const raw = req.headers['x-roles']
    const roles = typeof raw === 'string' ? raw.split(',').filter(Boolean) : []
    return { isAuthenticated: true, roles }
  }
  authorize(_params: AuthorizeParams): boolean {
    return true
  }
}

const RESOURCE_FIELDS: FieldDefinition[] = [
  { name: 'id', writable: false },
  { name: 'title' },
  { name: 'draft', writeRoles: ['editor', 'admin'] },
  { name: 'internalNotes', readRoles: ['admin'], writeRoles: ['admin'] }
]

function createApp(roles: string[] = []) {
  const app = express()
  app.use(express.json())
  const resource: ResourceDefinition = {
    name: 'Article',
    routePrefix: 'articles',
    fields: RESOURCE_FIELDS,
    repository: makeRepo()
  }
  app.use(
    '/api',
    createExpressCrudRouter([resource], {
      authStrategy: new FixedAuthStrategy({ isAuthenticated: true, roles })
    })
  )
  return app
}

function createDynamicApp() {
  const app = express()
  app.use(express.json())
  const resource: ResourceDefinition = {
    name: 'Article',
    routePrefix: 'articles',
    fields: RESOURCE_FIELDS,
    repository: makeRepo()
  }
  app.use(
    '/api',
    createExpressCrudRouter([resource], { authStrategy: new HeaderRoleStrategy() })
  )
  return app
}

describe('per-field read authorization', () => {
  describe('readRoles — field hidden from non-admin callers', () => {
    it('strips internalNotes from getOne for unprivileged caller', async () => {
      const app = createApp([]) // no roles
      const res = await request(app).get('/api/articles/1')
      expect(res.status).toBe(200)
      expect(res.body).not.toHaveProperty('internalNotes')
      expect(res.body).toMatchObject({ id: 1, title: 'Hello', draft: true })
    })

    it('includes internalNotes for admin caller', async () => {
      const app = createApp(['admin'])
      const res = await request(app).get('/api/articles/1')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ internalNotes: 'secret' })
    })

    it('strips internalNotes from getMany results for unprivileged caller', async () => {
      const app = createApp([])
      const res = await request(app).get('/api/articles')
      expect(res.status).toBe(200)
      expect(res.body.results[0]).not.toHaveProperty('internalNotes')
    })

    it('includes internalNotes in getMany results for admin', async () => {
      const app = createApp(['admin'])
      const res = await request(app).get('/api/articles')
      expect(res.status).toBe(200)
      expect(res.body.results[0]).toHaveProperty('internalNotes', 'secret')
    })

    it('strips internalNotes from createOne response for unprivileged caller', async () => {
      const app = createApp([])
      const res = await request(app)
        .post('/api/articles')
        .send({ title: 'New', draft: false, internalNotes: 'ignored' })
      expect(res.status).toBe(201)
      expect(res.body).not.toHaveProperty('internalNotes')
    })

    it('includes internalNotes in createOne response for admin', async () => {
      const app = createApp(['admin'])
      const res = await request(app)
        .post('/api/articles')
        .send({ title: 'New', draft: false, internalNotes: 'visible' })
      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('internalNotes', 'visible')
    })

    it('strips internalNotes from updateOne response for unprivileged caller', async () => {
      const app = createApp([])
      const res = await request(app).patch('/api/articles/1').send({ title: 'Updated' })
      expect(res.status).toBe(200)
      expect(res.body).not.toHaveProperty('internalNotes')
    })

    it('includes internalNotes in updateOne response for admin', async () => {
      const app = createApp(['admin'])
      const res = await request(app).patch('/api/articles/1').send({ title: 'Updated' })
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('internalNotes')
    })

    it('handles dynamic roles correctly via request header', async () => {
      const app = createDynamicApp()

      const noRoles = await request(app).get('/api/articles/1').set('X-Roles', '')
      expect(noRoles.body).not.toHaveProperty('internalNotes')

      const adminRole = await request(app).get('/api/articles/1').set('X-Roles', 'admin')
      expect(adminRole.body).toHaveProperty('internalNotes')
    })
  })
})

describe('per-field write authorization', () => {
  describe('writeRoles — field silently dropped for callers without the role', () => {
    it('strips draft from write body when caller has no roles', async () => {
      const app = createApp([])
      // Attempt to write draft=false; should be silently dropped (stays true from seed)
      const res = await request(app).patch('/api/articles/1').send({ title: 'T', draft: false })
      expect(res.status).toBe(200)
      expect(res.body.draft).toBe(true) // draft unchanged — was stripped
      expect(res.body.title).toBe('T') // title updated normally
    })

    it('allows draft to be written when caller has editor role', async () => {
      const app = createApp(['editor'])
      const res = await request(app).patch('/api/articles/1').send({ title: 'T', draft: false })
      expect(res.status).toBe(200)
      expect(res.body.draft).toBe(false)
    })

    it('allows draft to be written when caller has admin role', async () => {
      const app = createApp(['admin'])
      const res = await request(app).patch('/api/articles/1').send({ draft: false })
      expect(res.status).toBe(200)
      expect(res.body.draft).toBe(false)
    })

    it('strips internalNotes from write body when caller has no admin role', async () => {
      const app = createApp(['editor'])
      const res = await request(app)
        .post('/api/articles')
        .send({ title: 'New', internalNotes: 'should be dropped' })
      expect(res.status).toBe(201)
      // internalNotes was dropped from the write body; repo receives no value
      expect(res.body).not.toHaveProperty('internalNotes')
    })

    it('allows internalNotes write for admin', async () => {
      const app = createApp(['admin'])
      const res = await request(app)
        .post('/api/articles')
        .send({ title: 'New', internalNotes: 'admin note' })
      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('internalNotes', 'admin note')
    })

    it('still rejects truly unknown fields with 422', async () => {
      const app = createApp(['admin'])
      const res = await request(app)
        .patch('/api/articles/1')
        .send({ nonExistentField: 'x' })
      expect(res.status).toBe(422)
    })

    it('matching permission (not just role) grants write access', async () => {
      const app = express()
      app.use(express.json())
      const resource: ResourceDefinition = {
        name: 'Article',
        routePrefix: 'articles',
        fields: RESOURCE_FIELDS,
        repository: makeRepo()
      }
      app.use(
        '/api',
        createExpressCrudRouter([resource], {
          authStrategy: new FixedAuthStrategy({
            isAuthenticated: true,
            permissions: ['editor'] // permission, not role
          })
        })
      )
      const res = await request(app).patch('/api/articles/1').send({ draft: false })
      expect(res.status).toBe(200)
      expect(res.body.draft).toBe(false)
    })
  })

  describe('combined read + write restrictions', () => {
    it('admin can both write and read internalNotes', async () => {
      const app = createApp(['admin'])
      const res = await request(app)
        .patch('/api/articles/1')
        .send({ internalNotes: 'updated secret' })
      expect(res.status).toBe(200)
      expect(res.body.internalNotes).toBe('updated secret')
    })

    it('non-admin cannot write or see internalNotes', async () => {
      const app = createApp([])
      const patchRes = await request(app)
        .patch('/api/articles/1')
        .send({ internalNotes: 'attempt' })
      expect(patchRes.status).toBe(200)
      expect(patchRes.body).not.toHaveProperty('internalNotes')

      // Confirm the field was not changed by reading with an admin
      const adminApp = createApp(['admin'])
      const getRes = await request(adminApp).get('/api/articles/1')
      expect(getRes.body.internalNotes).toBe('secret') // unchanged
    })
  })
})

describe('fieldDefinition defaults', () => {
  it('fields without readRoles are visible to all callers', async () => {
    const app = createApp([])
    const res = await request(app).get('/api/articles/1')
    expect(res.body).toHaveProperty('title')
    expect(res.body).toHaveProperty('draft')
  })

  it('fields without writeRoles are writable by all callers', async () => {
    const app = createApp([])
    const res = await request(app).patch('/api/articles/1').send({ title: 'Updated title' })
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Updated title')
  })
})
