import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createExpressCrudRouter } from '@/adapters/http/express.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import type { ResourceDefinition } from '@/core/types.js'
import type { Repository, ListResult, CreateOptions } from '@/core/repository.js'

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
    }
  }
}

function createApp(
  seed: User[] = [
    { id: 1, email: 'one@example.com' },
    { id: 2, email: 'two@example.com' }
  ]
) {
  const app = express()
  app.use(express.json())

  const resource: ResourceDefinition = {
    name: 'User',
    routePrefix: 'users',
    fields: [
      { name: 'id', filterable: true },
      { name: 'email', filterable: true }
    ],
    permissions: {
      allowCreate: true,
      allowReadOne: true,
      allowReadMany: true,
      allowUpdateOne: true,
      allowDeleteOne: true
    },
    repository: makeUserRepo(seed)
  }

  app.use(
    '/api/v1',
    createExpressCrudRouter([resource], { authStrategy: new ApiKeyAuthStrategy('secret') })
  )
  return app
}

function createSecuredApp() {
  const app = express()
  app.use(express.json())

  const records: Array<{ id: number; email: string; role: string }> = [
    { id: 1, email: 'one@example.com', role: 'user' }
  ]

  const repo: Repository<
    (typeof records)[0],
    Partial<(typeof records)[0]>,
    Partial<(typeof records)[0]>
  > = {
    async getOne(id) {
      return records.find((r) => r.id === Number(id)) ?? null
    },
    async getMany() {
      return { count: records.length, results: [...records] }
    },
    async createOne(data) {
      const r = { id: Date.now(), email: '', role: 'user', ...data }
      records.push(r)
      return r
    },
    async createMany(data) {
      const rs = data.map((d) => ({ id: Date.now(), email: '', role: 'user', ...d }))
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
    }
  }

  const resource: ResourceDefinition = {
    name: 'User',
    routePrefix: 'users',
    fields: [
      { name: 'id', filterable: true, sortable: true, selectable: true },
      { name: 'email', filterable: true, sortable: true, selectable: true, writable: true },
      { name: 'role', filterable: false, sortable: false, selectable: false, writable: false }
    ],
    permissions: {
      allowCreate: true,
      allowReadOne: true,
      allowReadMany: true,
      allowUpdateOne: true
    },
    repository: repo
  }

  app.use(
    '/api/v1',
    createExpressCrudRouter([resource], { authStrategy: new ApiKeyAuthStrategy('secret') })
  )
  return app
}

function createLimitedApp() {
  const app = express()
  app.use(express.json())

  const records = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, email: `u${i}@x.com` }))
  const repo: Repository<
    (typeof records)[0],
    Partial<(typeof records)[0]>,
    Partial<(typeof records)[0]>
  > = {
    async getOne(id) {
      return records.find((r) => r.id === Number(id)) ?? null
    },
    async getMany(opts) {
      const page = opts?.limit
        ? records.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit)
        : [...records]
      return { count: records.length, results: page }
    },
    async createOne(data) {
      return { id: 999, email: '', ...data }
    },
    async createMany(data) {
      return data.map((d) => ({ id: 999, email: '', ...d }))
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
    }
  }

  const resource: ResourceDefinition = {
    name: 'User',
    routePrefix: 'users',
    fields: [{ name: 'id' }, { name: 'email' }],
    permissions: { allowReadMany: true },
    defaultLimit: 5,
    maxLimit: 10,
    repository: repo
  }

  app.use(
    '/api/v1',
    createExpressCrudRouter([resource], { authStrategy: new ApiKeyAuthStrategy('secret') })
  )
  return app
}

describe('createExpressCrudRouter — auth', () => {
  it('blocks requests with no API key', async () => {
    expect((await request(createApp()).get('/api/v1/users')).status).toBe(403)
  })

  it('blocks requests with a wrong API key', async () => {
    expect((await request(createApp()).get('/api/v1/users').set('x-api-key', 'bad')).status).toBe(
      403
    )
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
    const res = await request(createApp()).delete('/api/v1/users/1').set('x-api-key', 'secret')
    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(true)
  })

  it('returns 404 when record does not exist', async () => {
    const res = await request(createApp()).delete('/api/v1/users/999').set('x-api-key', 'secret')
    expect(res.status).toBe(404)
  })
})

describe('createExpressCrudRouter — query string validation', () => {
  it('returns 400 for an unknown query parameter', async () => {
    const res = await request(createApp()).get('/api/v1/users?bogus=x').set('x-api-key', 'secret')
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

describe('createExpressCrudRouter — UUID id support', () => {
  it('accepts a valid UUID as the id param and returns 404 (not 400)', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const res = await request(createApp()).get(`/api/v1/users/${uuid}`).set('x-api-key', 'secret')
    expect(res.status).toBe(404)
  })

  it('rejects a malformed UUID-like string with 400', async () => {
    const res = await request(createApp())
      .get('/api/v1/users/not-a-uuid')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(400)
    expect(res.body.error.name).toBe('PayloadError')
  })

  it('still accepts integer ids', async () => {
    const res = await request(createApp()).get('/api/v1/users/1').set('x-api-key', 'secret')
    expect(res.status).toBe(200)
  })
})

describe('createExpressCrudRouter — field security', () => {
  it('returns 400 when filtering on a non-filterable field', async () => {
    const res = await request(createSecuredApp())
      .get('/api/v1/users?role=admin')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(400)
    expect(res.body.error.name).toBe('PayloadError')
  })

  it('returns 400 when selecting a non-selectable field via ?fields=', async () => {
    const res = await request(createSecuredApp())
      .get('/api/v1/users?fields=role')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(400)
    expect(res.body.error.name).toBe('PayloadError')
  })

  it('returns 400 when sorting on a non-sortable field via ?order=', async () => {
    const res = await request(createSecuredApp())
      .get('/api/v1/users?order=role')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(400)
    expect(res.body.error.name).toBe('PayloadError')
  })

  it('strips non-writable fields from create body', async () => {
    const res = await request(createSecuredApp())
      .post('/api/v1/users')
      .set('x-api-key', 'secret')
      .send({ email: 'new@example.com', role: 'superadmin' })
    expect(res.status).toBe(201)
    expect(res.body.role).not.toBe('superadmin')
  })

  it('strips non-writable fields from update body', async () => {
    const res = await request(createSecuredApp())
      .patch('/api/v1/users/1')
      .set('x-api-key', 'secret')
      .send({ email: 'updated@example.com', role: 'superadmin' })
    expect(res.status).toBe(200)
    expect(res.body.role).not.toBe('superadmin')
  })
})

describe('createExpressCrudRouter — limit constraints', () => {
  it('applies defaultLimit when no limit is specified', async () => {
    const res = await request(createLimitedApp()).get('/api/v1/users').set('x-api-key', 'secret')
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(5)
  })

  it('caps requests over maxLimit', async () => {
    const res = await request(createLimitedApp())
      .get('/api/v1/users?limit=50')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(10)
  })

  it('respects a limit below maxLimit', async () => {
    const res = await request(createLimitedApp())
      .get('/api/v1/users?limit=3')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(3)
  })
})

describe('createExpressCrudRouter — HTTP 406', () => {
  it('returns 406 when Accept excludes application/json', async () => {
    const res = await request(createApp()).get('/api/v1/users').set('x-api-key', 'secret').set('Accept', 'text/html')
    expect(res.status).toBe(406)
  })

  it('returns 406 for Accept: text/plain, text/html', async () => {
    const res = await request(createApp())
      .get('/api/v1/users')
      .set('x-api-key', 'secret')
      .set('Accept', 'text/plain, text/html')
    expect(res.status).toBe(406)
  })

  it('allows Accept: */*', async () => {
    const res = await request(createApp()).get('/api/v1/users').set('x-api-key', 'secret').set('Accept', '*/*')
    expect(res.status).toBe(200)
  })

  it('allows Accept: application/json', async () => {
    const res = await request(createApp())
      .get('/api/v1/users')
      .set('x-api-key', 'secret')
      .set('Accept', 'application/json')
    expect(res.status).toBe(200)
  })

  it('allows Accept: application/json, */*', async () => {
    const res = await request(createApp())
      .get('/api/v1/users')
      .set('x-api-key', 'secret')
      .set('Accept', 'application/json, */*')
    expect(res.status).toBe(200)
  })

  it('allows requests with no Accept header', async () => {
    const res = await request(createApp()).get('/api/v1/users').set('x-api-key', 'secret').unset('Accept')
    expect(res.status).toBe(200)
  })
})

describe('createExpressCrudRouter — X-Correlation-ID', () => {
  it('echoes X-Correlation-ID in a success response', async () => {
    const res = await request(createApp())
      .get('/api/v1/users')
      .set('x-api-key', 'secret')
      .set('X-Correlation-ID', 'trace-abc')
    expect(res.status).toBe(200)
    expect(res.headers['x-correlation-id']).toBe('trace-abc')
  })

  it('echoes X-Correlation-ID in an error response', async () => {
    const res = await request(createApp())
      .get('/api/v1/users/not-a-valid-id')
      .set('x-api-key', 'secret')
      .set('X-Correlation-ID', 'trace-xyz')
    expect(res.status).toBe(400)
    expect(res.headers['x-correlation-id']).toBe('trace-xyz')
  })

  it('does not set X-Correlation-ID when the header is absent', async () => {
    const res = await request(createApp()).get('/api/v1/users').set('x-api-key', 'secret')
    expect(res.headers['x-correlation-id']).toBeUndefined()
  })
})

describe('createExpressCrudRouter — Idempotency-Key', () => {
  function createIdempotencyApp() {
    const app = express()
    app.use(express.json())

    let capturedKey: string | undefined

    const repo: Repository<User, Partial<User>, Partial<User>> = {
      async getOne() {
        return null
      },
      async getMany() {
        return { count: 0, results: [] }
      },
      async createOne(data: Partial<User>, options?: CreateOptions) {
        capturedKey = options?.idempotencyKey
        return { id: 1, email: (data as User).email ?? '' }
      },
      async createMany(data: Partial<User>[], options?: CreateOptions) {
        capturedKey = options?.idempotencyKey
        return data.map((d) => ({ id: 1, email: (d as User).email ?? '' }))
      },
      async updateOne() {
        return null
      },
      async deleteOne() {
        return false
      },
    }

    const resource: ResourceDefinition = {
      name: 'User',
      routePrefix: 'users',
      fields: [{ name: 'id' }, { name: 'email' }],
      permissions: { allowCreate: true },
      repository: repo,
    }

    app.use('/api/v1', createExpressCrudRouter([resource]))

    return { app, getKey: () => capturedKey }
  }

  it('passes Idempotency-Key to repository createOne', async () => {
    const { app, getKey } = createIdempotencyApp()
    await request(app).post('/api/v1/users').send({ email: 'x@x.com' }).set('Idempotency-Key', 'key-abc-123')
    expect(getKey()).toBe('key-abc-123')
  })

  it('passes Idempotency-Key to repository createMany', async () => {
    const { app, getKey } = createIdempotencyApp()
    await request(app)
      .post('/api/v1/users')
      .send([{ email: 'a@x.com' }, { email: 'b@x.com' }])
      .set('Idempotency-Key', 'batch-key-456')
    expect(getKey()).toBe('batch-key-456')
  })

  it('passes undefined options when Idempotency-Key is absent', async () => {
    const { app, getKey } = createIdempotencyApp()
    await request(app).post('/api/v1/users').send({ email: 'x@x.com' })
    expect(getKey()).toBeUndefined()
  })
})
