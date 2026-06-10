import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createExpressCrudRouter } from '@/adapters/http/express.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import type { ResourceDefinition } from '@/core/types.js'
import type { Repository, ListResult } from '@/core/repository.js'

type User = { id: number; email: string }

function makeUserRepo(seed: User[] = []): Repository<User, Partial<User>, Partial<User>> {
  const records = [...seed]
  return {
    async getOne(id) {
      return records.find((r) => r.id === Number(id)) ?? null
    },
    async getMany(): Promise<ListResult<User>> {
      return { count: records.length, results: [...records] }
    },
    async createOne(data) {
      const r = { id: Date.now(), ...data } as User
      records.push(r)
      return r
    },
    async createMany(data) {
      const rs = data.map((d) => ({ id: Date.now(), ...d }) as User)
      records.push(...rs)
      return rs
    },
    async updateOne(id, data) {
      const r = records.find((x) => x.id === Number(id))
      if (!r) return null
      Object.assign(r, data)
      return r
    },
    async deleteOne(id) {
      const idx = records.findIndex((r) => r.id === Number(id))
      if (idx === -1) return false
      records.splice(idx, 1)
      return true
    },
  }
}

function createApp(seed: User[] = [{ id: 1, email: 'one@example.com' }, { id: 2, email: 'two@example.com' }]) {
  const app = express()
  app.use(express.json())

  const resource: ResourceDefinition = {
    name: 'User',
    routePrefix: 'users',
    fields: [
      { name: 'id', filterable: true },
      { name: 'email', filterable: true },
    ],
    permissions: {
      allowCreate: true,
      allowReadOne: true,
      allowReadMany: true,
      allowUpdateOne: true,
      allowDeleteOne: true,
    },
    repository: makeUserRepo(seed),
  }

  app.use('/api/v1', createExpressCrudRouter([resource], { authStrategy: new ApiKeyAuthStrategy('secret') }))
  return app
}

describe('createExpressCrudRouter — auth', () => {
  it('blocks requests with no API key', async () => {
    expect((await request(createApp()).get('/api/v1/users')).status).toBe(403)
  })

  it('blocks requests with a wrong API key', async () => {
    expect(
      (await request(createApp()).get('/api/v1/users').set('x-api-key', 'bad')).status
    ).toBe(403)
  })
})

describe('createExpressCrudRouter — read many', () => {
  it('returns all records with count', async () => {
    const res = await request(createApp()).get('/api/v1/users').set('x-api-key', 'secret')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
    expect(res.body.results).toHaveLength(2)
  })
})

describe('createExpressCrudRouter — read one', () => {
  it('returns the record by id', async () => {
    const res = await request(createApp()).get('/api/v1/users/1').set('x-api-key', 'secret')
    expect(res.status).toBe(200)
    expect(res.body.email).toBe('one@example.com')
  })

  it('returns 404 for a missing id', async () => {
    const res = await request(createApp()).get('/api/v1/users/999').set('x-api-key', 'secret')
    expect(res.status).toBe(404)
  })

  it('returns 400 for a non-integer id', async () => {
    const res = await request(createApp()).get('/api/v1/users/abc').set('x-api-key', 'secret')
    expect(res.status).toBe(400)
    expect(res.body.error.name).toBe('PayloadError')
  })

  it('returns 400 for id zero', async () => {
    const res = await request(createApp()).get('/api/v1/users/0').set('x-api-key', 'secret')
    expect(res.status).toBe(400)
  })
})

describe('createExpressCrudRouter — create', () => {
  it('creates a single record and returns 201', async () => {
    const res = await request(createApp())
      .post('/api/v1/users')
      .set('x-api-key', 'secret')
      .send({ email: 'new@example.com' })
    expect(res.status).toBe(201)
    expect(res.body.email).toBe('new@example.com')
  })

  it('creates multiple records when body is an array and returns 201', async () => {
    const res = await request(createApp())
      .post('/api/v1/users')
      .set('x-api-key', 'secret')
      .send([{ email: 'a@example.com' }, { email: 'b@example.com' }])
    expect(res.status).toBe(201)
  })
})

describe('createExpressCrudRouter — update', () => {
  it('updates a record and returns 200', async () => {
    const res = await request(createApp())
      .patch('/api/v1/users/1')
      .set('x-api-key', 'secret')
      .send({ email: 'updated@example.com' })
    expect(res.status).toBe(200)
    expect(res.body.email).toBe('updated@example.com')
  })

  it('returns 404 when record does not exist', async () => {
    const res = await request(createApp())
      .patch('/api/v1/users/999')
      .set('x-api-key', 'secret')
      .send({ email: 'ghost@example.com' })
    expect(res.status).toBe(404)
  })
})

describe('createExpressCrudRouter — delete', () => {
  it('deletes a record and returns { deleted: true }', async () => {
    const res = await request(createApp())
      .delete('/api/v1/users/1')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(true)
  })

  it('returns 404 when record does not exist', async () => {
    const res = await request(createApp())
      .delete('/api/v1/users/999')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(404)
  })
})

describe('createExpressCrudRouter — query string validation', () => {
  it('returns 400 for an unknown query parameter', async () => {
    const res = await request(createApp())
      .get('/api/v1/users?bogus=x')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(400)
    expect(res.body.error.name).toBe('PayloadError')
  })

  it('returns 400 for an unknown fields selection', async () => {
    const res = await request(createApp())
      .get('/api/v1/users?fields=nonexistent')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(400)
  })
})

describe('createExpressCrudRouter — error response format', () => {
  it('error body has { error: { name, message } } shape', async () => {
    const res = await request(createApp()).get('/api/v1/users/abc').set('x-api-key', 'secret')
    expect(res.body).toHaveProperty('error')
    expect(res.body.error).toHaveProperty('name')
    expect(res.body.error).toHaveProperty('message')
    expect(typeof res.body.error.name).toBe('string')
    expect(typeof res.body.error.message).toBe('string')
  })

  it('404 body has { error: { message: "Not found" } }', async () => {
    const res = await request(createApp()).get('/api/v1/users/999').set('x-api-key', 'secret')
    expect(res.body.error.message).toBe('Not found')
  })
})
