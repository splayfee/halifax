import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createExpressCrudRouter } from '@/adapters/http/ExpressAdapter.js'
import { AllowAllAuthStrategy } from '@/auth/AuthStrategy.js'
import type { CrudApiOptions } from '@/core/crudRouter.js'
import type { ListResult, Repository, ResourceDefinition } from '@/core/types.js'

type Widget = { id: number; name: string }

function makeWidgetRepo(seed: Widget[] = [{ id: 1, name: 'one' }]): Repository<Widget> {
  const records = [...seed]
  return {
    async getOne(id) {
      return records.find((r) => r.id === Number(id)) ?? null
    },
    async getMany(): Promise<ListResult<Widget>> {
      return { count: records.length, results: [...records] }
    },
    async createOne(data) {
      const r = { id: records.length + 1, ...data } as Widget
      records.push(r)
      return r
    },
    async createMany(data) {
      const rs = data.map((d, i) => ({ id: records.length + i + 1, ...d }) as Widget)
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
      const r = { id: Number(id), ...data } as Widget
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

function createApp(
  resourceOverrides: Partial<ResourceDefinition> = {},
  options: CrudApiOptions = {}
) {
  const app = express()
  app.use(express.json())
  const resource: ResourceDefinition = {
    name: 'Widget',
    routePrefix: 'widgets',
    fields: [
      { name: 'id', filterable: true },
      { name: 'name', filterable: true, writable: true }
    ],
    repository: makeWidgetRepo(),
    ...resourceOverrides
  }
  app.use(
    '/api',
    createExpressCrudRouter([resource], { authStrategy: new AllowAllAuthStrategy(), ...options })
  )
  return app
}

describe('response envelope', () => {
  describe('default (no envelope) — backward compatible', () => {
    const app = createApp()

    it('sends list as a bare { count, results } body', async () => {
      const res = await request(app).get('/api/widgets')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ count: 1, results: [{ id: 1, name: 'one' }] })
    })

    it('sends a single record as a bare object', async () => {
      const res = await request(app).get('/api/widgets/1')
      expect(res.body).toEqual({ id: 1, name: 'one' })
    })

    it('sends delete confirmation bare', async () => {
      const res = await request(app).delete('/api/widgets/1')
      expect(res.body).toEqual({ deleted: true })
    })
  })

  describe('global envelope', () => {
    const app = createApp({}, { envelope: 'data' })

    it('wraps the whole list body under the key', async () => {
      const res = await request(app).get('/api/widgets')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ data: { count: 1, results: [{ id: 1, name: 'one' }] } })
    })

    it('wraps a single record', async () => {
      const res = await request(app).get('/api/widgets/1')
      expect(res.body).toEqual({ data: { id: 1, name: 'one' } })
    })

    it('wraps create (201)', async () => {
      const res = await request(app).post('/api/widgets').send({ name: 'two' })
      expect(res.status).toBe(201)
      expect(res.body).toEqual({ data: { id: 2, name: 'two' } })
    })

    it('wraps update', async () => {
      const res = await request(app).patch('/api/widgets/1').send({ name: 'renamed' })
      expect(res.body).toEqual({ data: { id: 1, name: 'renamed' } })
    })

    it('wraps upsert', async () => {
      const res = await request(app).put('/api/widgets/99').send({ name: 'new' })
      expect(res.body).toEqual({ data: { id: 99, name: 'new' } })
    })

    it('wraps the delete confirmation', async () => {
      const res = await request(app).delete('/api/widgets/1')
      expect(res.body).toEqual({ data: { deleted: true } })
    })

    it('never envelopes error bodies', async () => {
      const res = await request(app).get('/api/widgets/12345')
      expect(res.status).toBe(404)
      const errBody = res.body as { errors: Array<{ code: string; message: string }> }
      expect(errBody.errors[0]!.code).toBe('NOT_FOUND')
      expect(errBody.errors[0]!.message).toEqual(expect.any(String))
    })
  })

  describe('precedence and normalization', () => {
    it('per-resource envelope overrides the API-wide default', async () => {
      const app = createApp({ envelope: 'payload' }, { envelope: 'data' })
      const res = await request(app).get('/api/widgets/1')
      expect(res.body).toEqual({ payload: { id: 1, name: 'one' } })
    })

    it('per-resource null opts out of an API-wide envelope', async () => {
      const app = createApp({ envelope: null }, { envelope: 'data' })
      const res = await request(app).get('/api/widgets/1')
      expect(res.body).toEqual({ id: 1, name: 'one' })
    })

    it('treats an empty-string envelope as no envelope', async () => {
      const app = createApp({}, { envelope: '' })
      const res = await request(app).get('/api/widgets/1')
      expect(res.body).toEqual({ id: 1, name: 'one' })
    })
  })
})
