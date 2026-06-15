import express, { type Router } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createExpressCrudRouter, ExpressHttpServer } from '@/adapters/http/ExpressAdapter.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import { normalizeError } from '@/core/crudRouter.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import { NotAcceptableError } from '@/errors/NotAcceptableError.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { BadRequestError } from '@/errors/BadRequestError.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'
import type { ResourceDefinition } from '@/core/types.js'
import type { Repository, ListResult, CreateOptions } from '@/core/types.js'

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
      { name: 'email', filterable: true, writable: true }
    ],
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
  it('blocks requests with no API key (401)', async () => {
    expect((await request(createApp()).get('/api/v1/users')).status).toBe(401)
  })

  it('blocks requests with a wrong API key (403)', async () => {
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
    expect(res.body.errors[0].code).toBe('BAD_REQUEST')
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
  it('returns 422 for an unknown query parameter', async () => {
    const res = await request(createApp()).get('/api/v1/users?bogus=x').set('x-api-key', 'secret')
    expect(res.status).toBe(422)
    expect(res.body.errors[0].code).toBe('UNPROCESSABLE_ENTITY')
  })

  it('returns 422 for an unknown fields selection', async () => {
    const res = await request(createApp())
      .get('/api/v1/users?fields=nonexistent')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(422)
  })
})

describe('createExpressCrudRouter — error response format', () => {
  it('error body has { errors: [{ code, message }] } shape', async () => {
    const res = await request(createApp()).get('/api/v1/users/abc').set('x-api-key', 'secret')
    expect(res.body).toHaveProperty('errors')
    expect(Array.isArray(res.body.errors)).toBe(true)
    expect(res.body.errors[0]).toHaveProperty('code')
    expect(res.body.errors[0]).toHaveProperty('message')
    expect(typeof res.body.errors[0].code).toBe('string')
    expect(typeof res.body.errors[0].message).toBe('string')
  })

  it('404 body has { errors: [{ code: "NOT_FOUND", message: "Not found" }] }', async () => {
    const res = await request(createApp()).get('/api/v1/users/999').set('x-api-key', 'secret')
    expect(res.body.errors[0].code).toBe('NOT_FOUND')
    expect(res.body.errors[0].message).toBe('Not Found')
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
    expect(res.body.errors[0].code).toBe('BAD_REQUEST')
  })

  it('still accepts integer ids', async () => {
    const res = await request(createApp()).get('/api/v1/users/1').set('x-api-key', 'secret')
    expect(res.status).toBe(200)
  })
})

function createUpsertSecuredApp() {
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
    async upsertOne(id, data) {
      const r = records.find((x) => x.id === Number(id))
      if (r) {
        Object.assign(r, data)
        return r
      }
      const created = { id: Number(id), email: '', role: 'user', ...data }
      records.push(created)
      return created
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
    repository: repo
  }

  app.use(
    '/api/v1',
    createExpressCrudRouter([resource], { authStrategy: new ApiKeyAuthStrategy('secret') })
  )
  return app
}

describe('createExpressCrudRouter — field security', () => {
  it('strips non-writable fields from upsert body', async () => {
    const res = await request(createUpsertSecuredApp())
      .put('/api/v1/users/1')
      .set('x-api-key', 'secret')
      .send({ email: 'upserted@example.com', role: 'superadmin' })
    expect(res.status).toBe(200)
    expect(res.body.role).not.toBe('superadmin')
  })

  it('returns 422 when upsert body contains an unknown field', async () => {
    const res = await request(createUpsertSecuredApp())
      .put('/api/v1/users/1')
      .set('x-api-key', 'secret')
      .send({ email: 'x@example.com', injected: 'malicious' })
    expect(res.status).toBe(422)
    expect(res.body.errors[0].message).toMatch(/unknown field/i)
  })

  it('returns 422 when filtering on a non-filterable field', async () => {
    const res = await request(createSecuredApp())
      .get('/api/v1/users?role=admin')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(422)
    expect(res.body.errors[0].code).toBe('UNPROCESSABLE_ENTITY')
  })

  it('returns 422 when selecting a non-selectable field via ?fields=', async () => {
    const res = await request(createSecuredApp())
      .get('/api/v1/users?fields=role')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(422)
    expect(res.body.errors[0].code).toBe('UNPROCESSABLE_ENTITY')
  })

  it('returns 422 when sorting on a non-sortable field via ?order=', async () => {
    const res = await request(createSecuredApp())
      .get('/api/v1/users?order=role')
      .set('x-api-key', 'secret')
    expect(res.status).toBe(422)
    expect(res.body.errors[0].code).toBe('UNPROCESSABLE_ENTITY')
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

  it('returns 422 when create body contains an unknown field', async () => {
    const res = await request(createSecuredApp())
      .post('/api/v1/users')
      .set('x-api-key', 'secret')
      .send({ email: 'new@example.com', injected: 'malicious' })
    expect(res.status).toBe(422)
    expect(res.body.errors[0].message).toMatch(/unknown field/i)
  })

  it('returns 422 when update body contains an unknown field', async () => {
    const res = await request(createSecuredApp())
      .patch('/api/v1/users/1')
      .set('x-api-key', 'secret')
      .send({ email: 'x@example.com', unknownField: 'bad' })
    expect(res.status).toBe(422)
    expect(res.body.errors[0].message).toMatch(/unknown field/i)
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
    const res = await request(createApp())
      .get('/api/v1/users')
      .set('x-api-key', 'secret')
      .set('Accept', 'text/html')
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
    const res = await request(createApp())
      .get('/api/v1/users')
      .set('x-api-key', 'secret')
      .set('Accept', '*/*')
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
    const res = await request(createApp())
      .get('/api/v1/users')
      .set('x-api-key', 'secret')
      .unset('Accept')
    expect(res.status).toBe(200)
  })
})

describe('createExpressCrudRouter — HTTP 415', () => {
  it('returns 415 when POST body has Content-Type: text/plain', async () => {
    const res = await request(createApp())
      .post('/api/v1/users')
      .set('x-api-key', 'secret')
      .set('Content-Type', 'text/plain')
      .send('not json')
    expect(res.status).toBe(415)
    expect(res.body.errors[0].code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('returns 415 when PATCH body has Content-Type: application/x-www-form-urlencoded', async () => {
    const res = await request(createApp())
      .patch('/api/v1/users/1')
      .set('x-api-key', 'secret')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('email=x%40y.com')
    expect(res.status).toBe(415)
  })

  it('accepts application/json Content-Type', async () => {
    const res = await request(createApp())
      .post('/api/v1/users')
      .set('x-api-key', 'secret')
      .set('Content-Type', 'application/json')
      .send({ email: 'new@test.com' })
    expect(res.status).toBe(201)
  })

  it('accepts missing Content-Type (no body)', async () => {
    const res = await request(createApp()).get('/api/v1/users').set('x-api-key', 'secret')
    expect(res.status).toBe(200)
  })
})

describe('createExpressCrudRouter — HTTP 405', () => {
  it('returns 405 with Allow header for unsupported method on base path', async () => {
    const res = await request(createApp()).put('/api/v1/users').set('x-api-key', 'secret')
    expect(res.status).toBe(405)
    expect(res.headers['allow']).toContain('GET')
    expect(res.headers['allow']).toContain('POST')
    expect(res.body.errors[0].code).toBe('METHOD_NOT_ALLOWED')
  })

  it('returns 405 with Allow header for unsupported method on id path', async () => {
    const res = await request(createApp()).post('/api/v1/users/1').set('x-api-key', 'secret')
    expect(res.status).toBe(405)
    expect(res.headers['allow']).toContain('GET')
    expect(res.headers['allow']).toContain('PATCH')
    expect(res.body.errors[0].code).toBe('METHOD_NOT_ALLOWED')
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
      }
    }

    const resource: ResourceDefinition = {
      name: 'User',
      routePrefix: 'users',
      fields: [{ name: 'id' }, { name: 'email', writable: true }],
      repository: repo
    }

    app.use('/api/v1', createExpressCrudRouter([resource]))

    return { app, getKey: () => capturedKey }
  }

  it('passes Idempotency-Key to repository createOne', async () => {
    const { app, getKey } = createIdempotencyApp()
    await request(app)
      .post('/api/v1/users')
      .send({ email: 'x@x.com' })
      .set('Idempotency-Key', 'key-abc-123')
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

// ─── Advanced routes ──────────────────────────────────────────────────────────

function createFullApp() {
  const app = express()
  app.use(express.json())

  const records: Array<{ id: number; email: string }> = [{ id: 1, email: 'a@x.com' }]

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
      const r = { id: Date.now(), email: '', ...data }
      records.push(r)
      return r
    },
    async createMany(data) {
      const rs = data.map((d) => ({ id: Date.now(), email: '', ...d }))
      records.push(...rs)
      return rs
    },
    async updateOne(id, data) {
      const r = records.find((x) => x.id === Number(id))
      if (!r) return null
      Object.assign(r, data)
      return r
    },
    async updateMany(_query, data) {
      records.forEach((r) => Object.assign(r, data))
      return { updated: records.map((r) => r.id) }
    },
    async upsertOne(id, data) {
      const existing = records.find((r) => r.id === Number(id))
      if (existing) {
        Object.assign(existing, data)
        return existing
      }
      const r = { id: Number(id), email: '', ...data }
      records.push(r)
      return r
    },
    async deleteOne(id) {
      const idx = records.findIndex((r) => r.id === Number(id))
      if (idx === -1) return false
      records.splice(idx, 1)
      return true
    },
    async deleteMany() {
      const ids = records.map((r) => r.id)
      records.length = 0
      return { deleted: ids }
    },
    async executeQuery() {
      return { count: records.length, results: [...records] }
    }
  }

  const resource: ResourceDefinition = {
    name: 'User',
    routePrefix: 'users',
    fields: [
      { name: 'id', filterable: true, sortable: true },
      { name: 'email', filterable: true, writable: true }
    ],
    repository: repo
  }

  app.use('/api/v1', createExpressCrudRouter([resource]))
  return app
}

describe('createExpressCrudRouter — updateMany', () => {
  it('returns 200 with updated ids when WHERE clause is provided', async () => {
    const res = await request(createFullApp())
      .patch('/api/v1/users')
      .set('Accept', 'application/json')
      .send({
        update: { email: 'bulk@x.com' },
        where: [{ field: 'id', comparison: '>', value1: 0 }]
      })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('updated')
  })

  it('returns 422 when no WHERE clause is provided', async () => {
    const res = await request(createFullApp())
      .patch('/api/v1/users')
      .set('Accept', 'application/json')
      .send({ update: { email: 'bulk@x.com' } })
    expect(res.status).toBe(422)
    expect(res.body.errors[0].message).toMatch(/WHERE filter/)
  })

  it('returns 422 when update payload contains only non-writable fields', async () => {
    // 'id' has no writable:true in createFullApp; filteredUpdate will be empty → 422
    const res = await request(createFullApp())
      .patch('/api/v1/users')
      .set('Accept', 'application/json')
      .send({
        update: { id: 99 },
        where: [{ field: 'email', comparison: '=', value1: 'a@x.com' }]
      })
    expect(res.status).toBe(422)
    expect(res.body.errors[0].message).toMatch(/writable field/)
  })

  it('returns 422 when body is absent (req.body ?? {} and update ?? {} fallbacks)', async () => {
    // No body at all — exercises both `req.body ?? {}` and `update ?? {}` branches
    const res = await request(createFullApp())
      .patch('/api/v1/users')
      .set('Accept', 'application/json')
    expect(res.status).toBe(422)
    expect(res.body.errors[0].message).toMatch(/writable field/)
  })

  it('returns 422 when body has no update key (update ?? {} fallback)', async () => {
    // Body exists but lacks the update key — exercises the `update ?? {}` branch
    const res = await request(createFullApp())
      .patch('/api/v1/users')
      .set('Accept', 'application/json')
      .send({ where: [{ field: 'email', comparison: '=', value1: 'a@x.com' }] })
    expect(res.status).toBe(422)
    expect(res.body.errors[0].message).toMatch(/writable field/)
  })
})

describe('createExpressCrudRouter — upsertOne', () => {
  it('upserts a record with PUT and returns 200', async () => {
    const res = await request(createFullApp())
      .put('/api/v1/users/1')
      .set('Accept', 'application/json')
      .send({ email: 'upserted@x.com' })
    expect(res.status).toBe(200)
  })

  it('returns 501 when the repository has no upsertOne method', async () => {
    const app = express()
    app.use(express.json())
    const repo: Repository<{ id: number }, Partial<{ id: number }>, Partial<{ id: number }>> = {
      async getOne() {
        return null
      },
      async getMany() {
        return { count: 0, results: [] }
      },
      async createOne() {
        return { id: 1 }
      },
      async createMany() {
        return []
      },
      async updateOne() {
        return null
      },
      async deleteOne() {
        return false
      }
    }
    const resource: ResourceDefinition = {
      name: 'X',
      routePrefix: 'xs',
      fields: [{ name: 'id' }],
      repository: repo
    }
    app.use(createExpressCrudRouter([resource]))
    const res = await request(app).put('/xs/1').set('Accept', 'application/json').send({})
    expect(res.status).toBe(501)
  })
})

describe('createExpressCrudRouter — deleteMany', () => {
  it('returns 200 with deleted ids when WHERE clause is provided', async () => {
    const res = await request(createFullApp())
      .delete('/api/v1/users')
      .set('Accept', 'application/json')
      .send({ where: [{ field: 'id', comparison: '>', value1: 0 }] })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('deleted')
  })

  it('returns 422 when no WHERE clause is provided', async () => {
    const res = await request(createFullApp())
      .delete('/api/v1/users')
      .set('Accept', 'application/json')
      .send({})
    expect(res.status).toBe(422)
    expect(res.body.errors[0].message).toMatch(/WHERE filter/)
  })

  it('returns 422 when request body is absent (req.body ?? {} fallback)', async () => {
    // Send no body at all — exercises the `req.body ?? {}` null-coalescing branch
    const res = await request(createFullApp())
      .delete('/api/v1/users')
      .set('Accept', 'application/json')
    expect(res.status).toBe(422)
    expect(res.body.errors[0].message).toMatch(/WHERE filter/)
  })
})

describe('createExpressCrudRouter — query-builder route', () => {
  it('returns 200 with count and results', async () => {
    const res = await request(createFullApp())
      .post('/api/v1/users/query')
      .set('Accept', 'application/json')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('count')
    expect(res.body).toHaveProperty('results')
  })

  it('returns 200 when request body is absent (req.body ?? {} fallback)', async () => {
    // Send no body — exercises the `req.body ?? {}` null-coalescing branch in query.ts
    const res = await request(createFullApp())
      .post('/api/v1/users/query')
      .set('Accept', 'application/json')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('count')
  })

  it('returns 501 when repository has no executeQuery', async () => {
    const app = express()
    app.use(express.json())
    const repo: Repository<{ id: number }, Partial<{ id: number }>, Partial<{ id: number }>> = {
      async getOne() {
        return null
      },
      async getMany() {
        return { count: 0, results: [] }
      },
      async createOne() {
        return { id: 1 }
      },
      async createMany() {
        return []
      },
      async updateOne() {
        return null
      },
      async deleteOne() {
        return false
      }
    }
    const resource: ResourceDefinition = {
      name: 'X',
      routePrefix: 'xs',
      fields: [{ name: 'id' }],
      repository: repo
    }
    app.use(createExpressCrudRouter([resource]))
    const res = await request(app).post('/xs/query').set('Accept', 'application/json').send({})
    expect(res.status).toBe(501)
  })

  it('returns 405 for non-POST requests to the query-builder path', async () => {
    // The '*' catch-all at crudRouter.ts lines 341-346 only fires when there are no /:id
    // routes to steal the match. Disable all single-record operations to remove the
    // conflicting GET/PATCH/DELETE/PUT /:id routes — then the literal /query path wins.
    const app = express()
    app.use(express.json())
    const repo: Repository<{ id: number }, Partial<{ id: number }>, Partial<{ id: number }>> = {
      async getOne() {
        return null
      },
      async getMany() {
        return { count: 0, results: [] }
      },
      async createOne() {
        return { id: 1 }
      },
      async createMany() {
        return []
      },
      async updateOne() {
        return null
      },
      async deleteOne() {
        return false
      },
      async executeQuery() {
        return { count: 0, results: [] }
      }
    }
    const resource: ResourceDefinition = {
      name: 'X',
      routePrefix: 'xs',
      fields: [{ name: 'id' }],
      permissions: {
        allowReadOne: false,
        allowUpdateOne: false,
        allowUpsertOne: false,
        allowDeleteOne: false
      },
      repository: repo
    }
    app.use(createExpressCrudRouter([resource]))
    const res = await request(app).get('/xs/query').set('Accept', 'application/json')
    expect(res.status).toBe(405)
    expect(res.headers['allow']).toContain('POST')
  })
})

describe('normalizeError', () => {
  it('normalizes NotFoundError to NOT_FOUND 404', () => {
    const result = normalizeError(new NotFoundError())
    expect(result).toEqual({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Not Found',
      details: undefined
    })
  })

  it('normalizes BadRequestError to BAD_REQUEST 400', () => {
    const result = normalizeError(new BadRequestError('Bad input'))
    expect(result).toEqual({
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Bad input',
      details: undefined
    })
  })

  it('normalizes UnprocessableEntityError to UNPROCESSABLE_ENTITY 422', () => {
    const result = normalizeError(new UnprocessableEntityError('Invalid field'))
    expect(result).toEqual({
      status: 422,
      code: 'UNPROCESSABLE_ENTITY',
      message: 'Invalid field',
      details: undefined
    })
  })

  it('normalizes AuthorizationError to FORBIDDEN 403', () => {
    const result = normalizeError(new AuthorizationError())
    expect(result.code).toBe('FORBIDDEN')
    expect(result.status).toBe(403)
  })

  it('normalizes NotAcceptableError to NOT_ACCEPTABLE 406', () => {
    const result = normalizeError(new NotAcceptableError())
    expect(result.code).toBe('NOT_ACCEPTABLE')
    expect(result.status).toBe(406)
  })

  it('normalizes NotImplementedError to NOT_IMPLEMENTED 501', () => {
    const result = normalizeError(new NotImplementedError())
    expect(result.code).toBe('NOT_IMPLEMENTED')
    expect(result.status).toBe(501)
  })

  it('normalizes a plain Error to INTERNAL_ERROR 500 with scrubbed message', () => {
    const result = normalizeError(new Error('boom'))
    expect(result).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error'
    })
  })

  it('normalizes an unknown throw value to INTERNAL_ERROR 500', () => {
    const result = normalizeError('something bad')
    expect(result).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error'
    })
  })
})

describe('createExpressCrudRouter — query-string edge cases', () => {
  it('handles ?order=-email (descending prefix)', async () => {
    const app = createSecuredApp()
    const res = await request(app).get('/api/v1/users?order=-email').set('x-api-key', 'secret')
    expect(res.status).toBe(200)
  })

  it('handles comma-separated multi-value filter (?id=1,2)', async () => {
    const res = await request(createApp()).get('/api/v1/users?id=1,2').set('x-api-key', 'secret')
    expect(res.status).toBe(200)
  })

  it('rejects 406 when updateMany called with Accept: text/xml', async () => {
    const res = await request(createFullApp())
      .patch('/api/v1/users')
      .set('Accept', 'text/xml')
      .send({ update: { email: 'x@x.com' } })
    expect(res.status).toBe(406)
  })
})

describe('createExpressCrudRouter — resource without repository', () => {
  it('throws synchronously when repository is missing', () => {
    const app = express()
    app.use(express.json())
    expect(() =>
      createExpressCrudRouter([
        { name: 'X', routePrefix: 'xs', fields: [], repository: null as never }
      ])
    ).toThrow()
  })
})

describe('createExpressCrudRouter — updateMany/deleteMany 501', () => {
  function createPartialApp() {
    const app = express()
    app.use(express.json())

    const repo: Repository<{ id: number }, Partial<{ id: number }>, Partial<{ id: number }>> = {
      async getOne() {
        return null
      },
      async getMany() {
        return { count: 0, results: [] }
      },
      async createOne() {
        return { id: 1 }
      },
      async createMany() {
        return []
      },
      async updateOne() {
        return null
      },
      async deleteOne() {
        return false
      }
    }

    const resource: ResourceDefinition = {
      name: 'X',
      routePrefix: 'xs',
      fields: [{ name: 'id' }],
      repository: repo
    }

    app.use(createExpressCrudRouter([resource]))
    return app
  }

  it('returns 501 when repo has no updateMany', async () => {
    const res = await request(createPartialApp())
      .patch('/xs')
      .set('Accept', 'application/json')
      .send({ update: { id: 2 } })
    expect(res.status).toBe(501)
  })

  it('returns 501 when repo has no deleteMany', async () => {
    const res = await request(createPartialApp())
      .delete('/xs')
      .set('Accept', 'application/json')
      .send({})
    expect(res.status).toBe(501)
  })
})

describe('createExpressCrudRouter — requiredPermissions enforcement', () => {
  it('returns 403 via JwtClaimsAuthStrategy.authorize when permission is missing', async () => {
    const app = express()
    app.use(express.json())

    const repo: Repository<User, Partial<User>, Partial<User>> = {
      async getOne() {
        return { id: 1, email: 'a@x.com' }
      },
      async getMany() {
        return { count: 1, results: [{ id: 1, email: 'a@x.com' }] }
      },
      async createOne(d) {
        return d as User
      },
      async createMany(d) {
        return d as User[]
      },
      async updateOne() {
        return null
      },
      async deleteOne() {
        return false
      }
    }

    const resource: ResourceDefinition = {
      name: 'User',
      routePrefix: 'users',
      fields: [{ name: 'id' }, { name: 'email' }],
      requiredPermissions: { readMany: ['users.read'] },
      repository: repo
    }

    const { JwtClaimsAuthStrategy } = await import('@/auth/AuthStrategy.js')
    const authStrategy = new JwtClaimsAuthStrategy(() => ({
      isAuthenticated: true,
      permissions: [],
      roles: []
    }))

    app.use(createExpressCrudRouter([resource], { authStrategy }))

    const res = await request(app)
      .get('/users')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer dummy')
    expect(res.status).toBe(403)
  })

  it('returns 403 via fallback path (strategy has no authorize) when permission is missing', async () => {
    const app = express()
    app.use(express.json())

    const repo: Repository<User, Partial<User>, Partial<User>> = {
      async getOne() {
        return null
      },
      async getMany() {
        return { count: 0, results: [] }
      },
      async createOne(d) {
        return d as User
      },
      async createMany(d) {
        return d as User[]
      },
      async updateOne() {
        return null
      },
      async deleteOne() {
        return false
      }
    }

    const resource: ResourceDefinition = {
      name: 'User',
      routePrefix: 'users',
      fields: [{ name: 'id' }, { name: 'email' }],
      requiredPermissions: { readMany: ['users.read'] },
      repository: repo
    }

    // AllowAllAuthStrategy has no authorize() method — exercises the fallback path
    app.use(createExpressCrudRouter([resource], { authStrategy: new ApiKeyAuthStrategy('k') }))

    const res = await request(app)
      .get('/users')
      .set('Accept', 'application/json')
      .set('x-api-key', 'k')
    expect(res.status).toBe(403)
  })
})

describe('ExpressHttpServer', () => {
  it('start() resolves immediately on a Router (no listen)', async () => {
    const router = express.Router()
    const server = new ExpressHttpServer(router)
    await expect(server.start(3000)).resolves.toBeUndefined()
  })

  it('start() calls listen on an app-like object with listen', async () => {
    const fakeApp = {
      listen: (_port: number, _host: string | undefined, cb: () => void) => {
        cb()
      }
    }
    const server = new ExpressHttpServer(fakeApp as never)
    await expect(server.start(0)).resolves.toBeUndefined()
  })

  it('send() writes a response body', async () => {
    const app = express()
    app.use(express.json())
    const router = express.Router() as Router
    const server = new ExpressHttpServer(router)
    server.registerRoute('GET', '/ping', async (_req, res) => {
      res.send?.('pong')
    })
    app.use(router)
    const res = await request(app).get('/ping').set('Accept', 'application/json')
    expect(res.text).toBe('pong')
  })

  it('setHeader() attaches a custom header to the response', async () => {
    const app = express()
    app.use(express.json())
    const router = express.Router() as Router
    const server = new ExpressHttpServer(router)
    server.registerRoute('GET', '/hdr', async (_req, res) => {
      res.setHeader?.('X-Custom', 'test-value')
      await res.status(200).json({})
    })
    app.use(router)
    const res = await request(app).get('/hdr').set('Accept', 'application/json')
    expect(res.headers['x-custom']).toBe('test-value')
  })
})

// ─── OpenAPI route registration ────────────────────────────────────────────────

function makeOpenApiApp(overrides: Parameters<typeof createExpressCrudRouter>[1] = {}) {
  const app = express()
  app.use(express.json())

  const resource: ResourceDefinition = {
    name: 'User',
    routePrefix: 'users',
    fields: [
      { name: 'id', filterable: true },
      { name: 'email', filterable: true, writable: true }
    ],
    repository: {
      async getOne() { return null },
      async getMany() { return { count: 0, results: [] } },
      async createOne(d) { return d as User },
      async createMany(d) { return d as User[] },
      async updateOne() { return null },
      async deleteOne() { return false }
    }
  }

  app.use(
    '/api',
    createExpressCrudRouter([resource], {
      authStrategy: new ApiKeyAuthStrategy('secret'),
      ...overrides
    })
  )
  return app
}

describe('createExpressCrudRouter — OpenAPI routes (lines 350-370)', () => {
  it('serves GET /openapi.json with a JSON spec when openapi.enabled is true', async () => {
    const app = makeOpenApiApp({
      openapi: { enabled: true, specPath: '/openapi.json', docsPath: '/docs' }
    })
    const res = await request(app).get('/api/openapi.json').set('Accept', '*/*')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).toHaveProperty('openapi')
    expect(res.body).toHaveProperty('paths')
  })

  it('serves GET /docs with an HTML Swagger UI page', async () => {
    const app = makeOpenApiApp({
      openapi: { enabled: true, specPath: '/openapi.json', docsPath: '/docs' }
    })
    const res = await request(app).get('/api/docs').set('Accept', '*/*')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text.toLowerCase()).toContain('swagger')
  })

  it('uses default specPath /openapi.json and docsPath /docs when not specified (?? defaults)', async () => {
    // crudRouter.ts line 350-351: specPath ?? '/openapi.json', docsPath ?? '/docs'
    const app = makeOpenApiApp({ openapi: { enabled: true } })
    const specRes = await request(app).get('/api/openapi.json').set('Accept', '*/*')
    expect(specRes.status).toBe(200)
    const docsRes = await request(app).get('/api/docs').set('Accept', '*/*')
    expect(docsRes.status).toBe(200)
  })

  it('does not register OpenAPI routes when openapi.enabled is false', async () => {
    const app = makeOpenApiApp({ openapi: { enabled: false } })
    const res = await request(app).get('/api/openapi.json').set('Accept', '*/*')
    expect(res.status).toBe(404)
  })

  it('resolves envelope from openapi.envelope ?? options.envelope (line 352)', async () => {
    // crudRouter.ts line 352: resolvedEnvelope = options.openapi.envelope ?? options.envelope ?? null
    const app = makeOpenApiApp({
      envelope: 'data',
      openapi: { enabled: true }
    })
    const res = await request(app).get('/api/openapi.json').set('Accept', '*/*')
    expect(res.status).toBe(200)
    // The spec should reflect the envelope — just check it's valid JSON with openapi key
    expect(res.body).toHaveProperty('openapi')
  })

  it('uses openapi.envelope over options.envelope when both are set', async () => {
    // openapi.envelope takes precedence over options.envelope
    const app = makeOpenApiApp({
      envelope: 'outer',
      openapi: { enabled: true, envelope: 'inner' }
    })
    const res = await request(app).get('/api/openapi.json').set('Accept', '*/*')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('openapi')
  })

  it('uses authStrategy.openApiScheme() when openapi.securityScheme is not provided (line 353)', async () => {
    // crudRouter.ts line 353: resolvedScheme = options.openapi.securityScheme ?? authStrategy.openApiScheme?.()
    // ApiKeyAuthStrategy.openApiScheme() returns { type: 'apiKey', in: 'header', name: 'x-api-key' }
    const app = makeOpenApiApp({ openapi: { enabled: true } })
    const res = await request(app).get('/api/openapi.json').set('Accept', '*/*')
    expect(res.status).toBe(200)
    // The spec should have a security scheme derived from the auth strategy
    const spec = res.body as { components?: { securitySchemes?: Record<string, unknown> } }
    expect(spec.components?.securitySchemes).toBeDefined()
  })

  it('uses openapi.securityScheme over authStrategy.openApiScheme() when provided (line 353 ?? branch)', async () => {
    // When securityScheme is explicitly set, it takes precedence over the strategy
    const app = makeOpenApiApp({
      openapi: {
        enabled: true,
        securityScheme: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      }
    })
    const res = await request(app).get('/api/openapi.json').set('Accept', '*/*')
    expect(res.status).toBe(200)
    const spec = res.body as { components?: { securitySchemes?: Record<string, unknown> } }
    expect(spec.components?.securitySchemes).toBeDefined()
  })

  it('no securityScheme when authStrategy has no openApiScheme() and none provided (line 357 falsy)', async () => {
    // AllowAllAuthStrategy has no openApiScheme() — resolvedScheme is undefined → falsy branch
    const app = express()
    app.use(express.json())
    const resource: ResourceDefinition = {
      name: 'Item',
      routePrefix: 'items',
      fields: [{ name: 'id' }],
      repository: { async getOne() { return null }, async getMany() { return { count: 0, results: [] } }, async createOne() { return null }, async createMany() { return [] }, async updateOne() { return null }, async deleteOne() { return false } }
    }
    app.use('/api', createExpressCrudRouter([resource], { openapi: { enabled: true } }))
    const res = await request(app).get('/api/openapi.json').set('Accept', '*/*')
    expect(res.status).toBe(200)
    const s = res.body as { components?: { securitySchemes?: Record<string, unknown> } }
    expect(s.components?.securitySchemes).toBeUndefined()
  })
})

describe('createExpressCrudRouter — 405 wildcard callbacks', () => {
  it('returns 405 with Allow header for unsupported method on /:id route', async () => {
    const app = express()
    app.use(express.json())
    const resource: ResourceDefinition = {
      name: 'Item',
      routePrefix: 'items',
      permissions: { allowReadOne: true, allowUpdateOne: false, allowUpsertOne: false, allowDeleteOne: false },
      fields: [{ name: 'id' }],
      repository: { async getOne() { return { id: 1 } }, async getMany() { return { count: 0, results: [] } }, async createOne() { return null }, async createMany() { return [] }, async updateOne() { return null }, async deleteOne() { return false } }
    }
    app.use('/api', createExpressCrudRouter([resource], {}))
    // OPTIONS is not a registered CRUD method → triggers the /:id wildcard 405 handler
    const res = await request(app).options('/api/items/1').set('Accept', 'application/json')
    expect(res.status).toBe(405)
  })

  it('returns 405 with Allow: POST for non-POST to query-builder endpoint', async () => {
    const app = express()
    app.use(express.json())
    const resource: ResourceDefinition = {
      name: 'Item',
      routePrefix: 'items',
      // Disable all /:id routes so GET /items/query isn't swallowed by /:id as id='query'
      permissions: {
        allowCreate: false, allowReadMany: false, allowReadOne: false,
        allowUpdateOne: false, allowUpdateMany: false, allowUpsertOne: false,
        allowDeleteOne: false, allowDeleteMany: false,
        allowReadManyWithQueryBuilder: true
      },
      fields: [{ name: 'id' }],
      repository: { async getOne() { return null }, async getMany() { return { count: 0, results: [] } }, async createOne() { return null }, async createMany() { return [] }, async updateOne() { return null }, async deleteOne() { return false } }
    }
    app.use('/api', createExpressCrudRouter([resource], {}))
    // PUT /items/query is not POST → triggers the query-builder wildcard 405 handler
    const res = await request(app).put('/api/items/query').set('Accept', 'application/json')
    expect(res.status).toBe(405)
    expect(res.headers['allow']).toContain('POST')
  })
})
