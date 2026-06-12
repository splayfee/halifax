/**
 * 2.0.0 resource-definition defaults: permissive + minimal.
 *
 * Proves that a resource needs almost nothing declared — fields are writable/filterable/etc.
 * by default, the primary key is protected, the field list can come from the repository (with
 * the resource supplying only sparse overrides), and `supportsIncludes: false` actually gates
 * `?include=`.
 */
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createExpressCrudRouter } from '@/adapters/http/ExpressAdapter.js'
import type {
  FieldDefinition,
  ListResult,
  RelationDefinition,
  Repository,
  RepositoryCapabilities,
  ResourceDefinition
} from '@/core/types.js'

type Row = { id: number; title: string; secret: string }

/** A minimal in-memory repository that can optionally advertise schema + capabilities. */
function makeRepo(
  opts: {
    fields?: FieldDefinition[]
    relations?: RelationDefinition[]
    idField?: string
    capabilities?: Partial<RepositoryCapabilities>
  } = {}
): Repository<Row, Partial<Row>, Partial<Row>> & { rows: Row[] } {
  const rows: Row[] = []
  let nextId = 1
  return {
    rows,
    ...(opts.fields ? { fields: opts.fields } : {}),
    ...(opts.relations ? { relations: opts.relations } : {}),
    ...(opts.idField ? { idField: opts.idField } : {}),
    ...(opts.capabilities ? { capabilities: opts.capabilities } : {}),
    async getOne(id) {
      return rows.find((r) => r.id === Number(id)) ?? null
    },
    async getMany(): Promise<ListResult<Row>> {
      return { count: rows.length, results: [...rows] }
    },
    async createOne(data: Partial<Row>) {
      const row = { id: nextId++, title: '', secret: '', ...data } as Row
      rows.push(row)
      return row
    },
    async createMany(data: Partial<Row>[]) {
      return Promise.all(data.map((d) => this.createOne(d)))
    },
    async updateOne(id, data) {
      const row = rows.find((r) => r.id === Number(id))
      if (!row) return null
      Object.assign(row, data)
      return row
    },
    async deleteOne(id) {
      const i = rows.findIndex((r) => r.id === Number(id))
      if (i === -1) return false
      rows.splice(i, 1)
      return true
    }
  }
}

function appFor(resource: ResourceDefinition) {
  const app = express()
  app.use(express.json())
  app.use('/api', createExpressCrudRouter([resource]))
  return app
}

describe('ResourceDefinition — permissive + minimal defaults (2.0.0)', () => {
  it('a bare resource enables every CRUD action and derives nothing extra', async () => {
    const repo = makeRepo()
    // No name, no permissions, no limits — only the three required keys.
    const app = appFor({ routePrefix: 'rows', repository: repo, fields: [{ name: 'title' }] })

    expect((await request(app).post('/api/rows').send({ title: 'hi' })).status).toBe(201)
    expect((await request(app).get('/api/rows')).status).toBe(200)
  })

  it('fields are writable by default — no `writable: true` needed', async () => {
    const repo = makeRepo()
    const app = appFor({ routePrefix: 'rows', repository: repo, fields: [{ name: 'title' }] })

    const res = await request(app).post('/api/rows').send({ title: 'written' })
    expect(res.status).toBe(201)
    expect(res.body.title).toBe('written')
  })

  it('the primary key is protected from write bodies by default', async () => {
    const repo = makeRepo({ idField: 'id' })
    const app = appFor({
      routePrefix: 'rows',
      repository: repo,
      fields: [{ name: 'id' }, { name: 'title' }]
    })

    const res = await request(app).post('/api/rows').send({ id: 999, title: 'x' })
    expect(res.status).toBe(201)
    // The supplied id is ignored — the repo assigned its own.
    expect(res.body.id).toBe(1)
  })

  it('sources fields from the repository; resource entries are sparse overrides', async () => {
    // Repo knows the schema; the resource omits `fields` except to lock `secret` down.
    const repo = makeRepo({
      idField: 'id',
      fields: [{ name: 'id' }, { name: 'title' }, { name: 'secret' }]
    })
    const app = appFor({
      routePrefix: 'rows',
      repository: repo,
      fields: [{ name: 'secret', writable: false, selectable: false }]
    })

    const res = await request(app).post('/api/rows').send({ title: 't', secret: 'leak' })
    expect(res.status).toBe(201)
    expect(res.body.title).toBe('t') // base field, writable by default
    expect(repo.rows[0]!.secret).toBe('') // override stripped the non-writable field
  })

  it('rejects ?include= with 422 when the repository cannot eager-load', async () => {
    const repo = makeRepo({
      fields: [{ name: 'title' }],
      relations: [{ name: 'author' }],
      capabilities: { supportsIncludes: false }
    })
    const app = appFor({ routePrefix: 'rows', repository: repo })

    const res = await request(app).get('/api/rows?include=author')
    expect(res.status).toBe(422)
  })

  it('throws at registration when neither the resource nor repository provides fields', () => {
    const repo = makeRepo() // no fields exposed
    expect(() => appFor({ routePrefix: 'rows', repository: repo })).toThrow(/has no fields/)
  })
})
