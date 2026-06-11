import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ListResult, Repository, ResourceDefinition } from '@/core/types.js'

/**
 * The base path every adapter's contract suite mounts its CRUD routes under. Express,
 * Ultimate Express, and HyperExpress mount a router here; Fastify registers its plugin
 * with this as the `prefix`. Routes therefore live at `/api/v1/users`, etc.
 */
export const CONTRACT_PREFIX = '/api/v1'

/** Shared API key for the contract's {@link ApiKeyAuthStrategy}. */
export const CONTRACT_API_KEY = 'secret'

type User = { id: number; email: string; role: string }

/**
 * Builds a fully-featured in-memory repository so the contract can exercise every CRUD
 * branch (including upsert, bulk update/delete, and the query builder) with no database.
 * @param seed - Initial records.
 * @returns A {@link Repository} backed by an array.
 */
function makeUserRepo(seed: User[]): Repository<User, Partial<User>, Partial<User>> {
  const records = [...seed]
  return {
    async getOne(id) {
      return records.find((r) => r.id === Number(id)) ?? null
    },
    async getMany(): Promise<ListResult<User>> {
      return { count: records.length, results: [...records] }
    },
    async createOne(data: Partial<User>) {
      const r = { id: records.length + 1, email: '', role: 'user', ...data }
      records.push(r)
      return r
    },
    async createMany(data: Partial<User>[]) {
      return data.map((d) => {
        const r = { id: records.length + 1, email: '', role: 'user', ...d }
        records.push(r)
        return r
      })
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
      const r = { id: Number(id), email: '', role: 'user', ...data }
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
      const deleted = records.map((r) => r.id)
      records.length = 0
      return { deleted }
    },
    async executeQuery() {
      return { count: records.length, results: [...records] }
    }
  }
}

/**
 * The single resource definition all adapters wire up for the contract. `role` is a
 * non-writable field, so field-stripping behaviour can be asserted identically everywhere.
 * @returns A `users` {@link ResourceDefinition} with all CRUD operations enabled.
 */
export function contractResources(): ResourceDefinition[] {
  return [
    {
      name: 'User',
      routePrefix: 'users',
      fields: [
        { name: 'id', filterable: true, sortable: true, selectable: true },
        { name: 'email', filterable: true, sortable: true, selectable: true, writable: true },
        { name: 'role', filterable: false, sortable: false, selectable: false, writable: false }
      ],
      repository: makeUserRepo([
        { id: 1, email: 'one@example.com', role: 'user' },
        { id: 2, email: 'two@example.com', role: 'user' }
      ])
    }
  ]
}

/** Whatever supertest can target: an http.Server, a request listener, or a base URL string. */
export type ContractTarget = Parameters<typeof request>[0]

/** A started adapter under test: the supertest target plus a teardown hook. */
export interface ContractApp {
  target: ContractTarget
  close: () => Promise<void> | void
}

/**
 * Runs the full Express-parity contract against an adapter.
 *
 * Every adapter is asserted against the *identical* set of HTTP behaviours — status codes,
 * error-body shape, `Allow`/`X-Correlation-ID` headers, content negotiation — so "behaves
 * exactly like Express" is enforced by construction rather than by hand-written per-adapter
 * expectations.
 *
 * @param name - Display name for the suite (e.g. `'Fastify'`).
 * @param setup - Builds and starts the adapter's app, returning a supertest target + teardown.
 */
export function runAdapterContract(
  name: string,
  setup: () => Promise<ContractApp> | ContractApp
): void {
  describe(`${name} adapter — Express-parity contract`, () => {
    let app: ContractApp
    const agent = () => request(app.target)
    const key = (req: request.Test) => req.set('x-api-key', CONTRACT_API_KEY)

    beforeAll(async () => {
      app = await setup()
    })

    afterAll(async () => {
      await app.close()
    })

    it('returns 401 without an API key', async () => {
      expect((await agent().get('/api/v1/users')).status).toBe(401)
    })

    it('returns 403 with a wrong API key', async () => {
      expect((await agent().get('/api/v1/users').set('x-api-key', 'bad')).status).toBe(403)
    })

    it('GET list returns count and results', async () => {
      const res = await key(agent().get('/api/v1/users'))
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(2)
      expect(res.body.results).toHaveLength(2)
    })

    it('GET /:id returns the record', async () => {
      const res = await key(agent().get('/api/v1/users/1'))
      expect(res.status).toBe(200)
      expect(res.body.email).toBe('one@example.com')
    })

    it('GET /:id returns 404 for a missing id', async () => {
      expect((await key(agent().get('/api/v1/users/99999'))).status).toBe(404)
    })

    it('GET /:id returns 400 for a non-integer id', async () => {
      const res = await key(agent().get('/api/v1/users/abc'))
      expect(res.status).toBe(400)
      expect(res.body.errors[0].code).toBe('BAD_REQUEST')
    })

    it('POST creates a single record (201) and strips non-writable fields', async () => {
      const res = await key(agent().post('/api/v1/users')).send({
        email: 'new@example.com',
        role: 'superadmin'
      })
      expect(res.status).toBe(201)
      expect(res.body.email).toBe('new@example.com')
      expect(res.body.role).not.toBe('superadmin')
    })

    it('POST creates multiple records (201) when given an array', async () => {
      const res = await key(agent().post('/api/v1/users')).send([
        { email: 'a@example.com' },
        { email: 'b@example.com' }
      ])
      expect(res.status).toBe(201)
    })

    it('POST returns 422 for an unknown field', async () => {
      const res = await key(agent().post('/api/v1/users')).send({ email: 'x@x.com', bogus: 1 })
      expect(res.status).toBe(422)
      expect(res.body.errors[0].code).toBe('UNPROCESSABLE_ENTITY')
    })

    it('PATCH /:id updates a record (200)', async () => {
      const res = await key(agent().patch('/api/v1/users/1')).send({ email: 'updated@example.com' })
      expect(res.status).toBe(200)
      expect(res.body.email).toBe('updated@example.com')
    })

    it('PATCH /:id returns 404 for a missing id', async () => {
      const res = await key(agent().patch('/api/v1/users/99999')).send({ email: 'ghost@x.com' })
      expect(res.status).toBe(404)
    })

    it('PUT /:id upserts a record (200)', async () => {
      const res = await key(agent().put('/api/v1/users/8001')).send({ email: 'upserted@x.com' })
      expect(res.status).toBe(200)
      expect(res.body.email).toBe('upserted@x.com')
    })

    it('DELETE /:id removes a record (200)', async () => {
      const res = await key(agent().delete('/api/v1/users/2'))
      expect(res.status).toBe(200)
      expect(res.body.deleted).toBe(true)
    })

    it('DELETE /:id returns 404 for a missing id', async () => {
      expect((await key(agent().delete('/api/v1/users/99999'))).status).toBe(404)
    })

    it('returns 405 with an Allow header for an unsupported method on the base path', async () => {
      const res = await key(agent().put('/api/v1/users'))
      expect(res.status).toBe(405)
      expect(res.headers['allow']).toContain('GET')
      expect(res.headers['allow']).toContain('POST')
      expect(res.body.errors[0].code).toBe('METHOD_NOT_ALLOWED')
    })

    it('returns 405 with an Allow header for an unsupported method on the id path', async () => {
      const res = await key(agent().post('/api/v1/users/1'))
      expect(res.status).toBe(405)
      expect(res.headers['allow']).toContain('GET')
      expect(res.headers['allow']).toContain('PATCH')
    })

    it('returns 406 when Accept excludes application/json', async () => {
      const res = await key(agent().get('/api/v1/users')).set('Accept', 'text/html')
      expect(res.status).toBe(406)
    })

    it('returns 415 when a POST body uses a non-JSON Content-Type', async () => {
      const res = await key(agent().post('/api/v1/users'))
        .set('Content-Type', 'text/plain')
        .send('not json')
      expect(res.status).toBe(415)
      expect(res.body.errors[0].code).toBe('UNSUPPORTED_MEDIA_TYPE')
    })

    it('error bodies have the { errors: [{ code, message }] } shape', async () => {
      const res = await key(agent().get('/api/v1/users/abc'))
      expect(Array.isArray(res.body.errors)).toBe(true)
      expect(typeof res.body.errors[0].code).toBe('string')
      expect(typeof res.body.errors[0].message).toBe('string')
    })

    it('echoes X-Correlation-ID on success', async () => {
      const res = await key(agent().get('/api/v1/users')).set('X-Correlation-ID', 'trace-1')
      expect(res.headers['x-correlation-id']).toBe('trace-1')
    })

    it('echoes X-Correlation-ID on error', async () => {
      const res = await key(agent().get('/api/v1/users/abc')).set('X-Correlation-ID', 'trace-2')
      expect(res.headers['x-correlation-id']).toBe('trace-2')
    })

    it('runs the query-builder route (200)', async () => {
      const res = await key(agent().post('/api/v1/users/query')).send({
        fields: ['id', 'email'],
        where: [{ field: 'id', comparison: '>', value1: 0 }]
      })
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('count')
      expect(res.body).toHaveProperty('results')
    })

    it('query-builder rejects an unknown field with 422 (validation in front of the adapter)', async () => {
      const res = await key(agent().post('/api/v1/users/query')).send({
        where: [{ field: 'bogus', comparison: '=', value1: 1 }]
      })
      expect(res.status).toBe(422)
      expect(res.body.errors[0].code).toBe('UNPROCESSABLE_ENTITY')
    })
  })
}
