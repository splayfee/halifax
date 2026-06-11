import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi } from 'vitest'
import { PrismaAdapter, createPrismaResources } from '@/adapters/orm/prisma/index.js'
import { createExpressCrudRouter } from '@/adapters/http/ExpressAdapter.js'
import type { AuthContext, AuthStrategy } from '@/auth/AuthStrategy.js'
import type { ResourceDefinition } from '@/core/types.js'

type Row = { id: number; companyId: number; name: string }

/** A delegate whose write/read args we can assert against. */
function makeDelegate(overrides: Record<string, unknown> = {}) {
  return {
    findUnique: vi.fn().mockResolvedValue({ id: 1, companyId: 7, name: 'a' }),
    findFirst: vi.fn().mockResolvedValue({ id: 1, companyId: 7, name: 'a' }),
    findMany: vi.fn().mockResolvedValue([{ id: 1, companyId: 7, name: 'a' }]),
    count: vi.fn().mockResolvedValue(1),
    create: vi
      .fn()
      .mockImplementation(({ data }: { data: Partial<Row> }) =>
        Promise.resolve({ id: 99, ...data } as Row)
      ),
    createMany: vi.fn().mockResolvedValue({ count: 2 }),
    update: vi
      .fn()
      .mockImplementation(({ data }: { data: Partial<Row> }) =>
        Promise.resolve({ id: 1, companyId: 7, ...data } as Row)
      ),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi
      .fn()
      .mockImplementation(({ create }: { create: Partial<Row> }) =>
        Promise.resolve({ id: 1, ...create } as Row)
      ),
    delete: vi.fn().mockResolvedValue({ id: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    ...overrides
  }
}

const SCOPE = { field: 'companyId', value: 7 } as const

describe('PrismaAdapter.withScope — reads', () => {
  it('returns a new instance and leaves the original unscoped', async () => {
    const delegate = makeDelegate()
    const base = new PrismaAdapter<Row>({ delegate })
    const scoped = base.withScope(SCOPE)

    expect(scoped).not.toBe(base)

    await base.getMany({})
    expect(delegate.count).toHaveBeenLastCalledWith({ where: undefined })
  })

  it('getMany applies the tenant filter to both findMany and count', async () => {
    const delegate = makeDelegate()
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    await repo.getMany({ where: { name: 'a' } })

    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'a', companyId: 7 } })
    )
    expect(delegate.count).toHaveBeenCalledWith({ where: { name: 'a', companyId: 7 } })
  })

  it('getMany scope overrides a caller-supplied tenant value (no spoofing)', async () => {
    const delegate = makeDelegate()
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    await repo.getMany({ where: { companyId: 999 } })

    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 7 } })
    )
  })

  it('getOne uses findFirst with the tenant filter (not findUnique)', async () => {
    const delegate = makeDelegate()
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    await repo.getOne(1)

    expect(delegate.findUnique).not.toHaveBeenCalled()
    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, companyId: 7 } })
    )
  })

  it('getOne returns null for a row outside the tenant', async () => {
    const delegate = makeDelegate({ findFirst: vi.fn().mockResolvedValue(null) })
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    expect(await repo.getOne(1)).toBeNull()
  })
})

describe('PrismaAdapter.withScope — writes', () => {
  it('createOne stamps the tenant value, overriding the body', async () => {
    const delegate = makeDelegate()
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    await repo.createOne({ name: 'x', companyId: 999 } as Partial<Row>)

    expect(delegate.create).toHaveBeenCalledWith({
      data: { name: 'x', companyId: 7 }
    })
  })

  it('createMany stamps every row in the bulk path', async () => {
    const delegate = makeDelegate()
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    await repo.createMany([{ name: 'x' }, { name: 'y', companyId: 999 }] as Partial<Row>[])

    expect(delegate.createMany).toHaveBeenCalledWith({
      data: [
        { name: 'x', companyId: 7 },
        { name: 'y', companyId: 7 }
      ]
    })
  })

  it('updateOne verifies ownership then strips the tenant field from the payload', async () => {
    const delegate = makeDelegate()
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    await repo.updateOne(1, { name: 'z', companyId: 999 } as Partial<Row>)

    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, companyId: 7 } })
    )
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name: 'z' } // companyId stripped — cannot move tenants
    })
  })

  it('updateOne returns null without updating when the row is in another tenant', async () => {
    const delegate = makeDelegate({ findFirst: vi.fn().mockResolvedValue(null) })
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    expect(await repo.updateOne(1, { name: 'z' } as Partial<Row>)).toBeNull()
    expect(delegate.update).not.toHaveBeenCalled()
  })

  it('deleteOne deletes through scoped deleteMany (atomic ownership check)', async () => {
    const delegate = makeDelegate()
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    expect(await repo.deleteOne(1)).toBe(true)
    expect(delegate.deleteMany).toHaveBeenCalledWith({ where: { id: 1, companyId: 7 } })
    expect(delegate.delete).not.toHaveBeenCalled()
  })

  it('deleteOne reports not-found when scoped deleteMany affects zero rows', async () => {
    const delegate = makeDelegate({ deleteMany: vi.fn().mockResolvedValue({ count: 0 }) })
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    expect(await repo.deleteOne(1)).toBe(false)
  })

  it('upsertOne refuses to hijack a row owned by another tenant', async () => {
    const delegate = makeDelegate({
      findFirst: vi.fn().mockResolvedValue({ id: 1, companyId: 999, name: 'other' })
    })
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    await expect(repo.upsertOne(1, { name: 'z' } as Row)).rejects.toMatchObject({ status: 404 })
    expect(delegate.upsert).not.toHaveBeenCalled()
  })

  it('upsertOne stamps create and strips tenant from update for an owned/new row', async () => {
    const delegate = makeDelegate({ findFirst: vi.fn().mockResolvedValue(null) })
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    await repo.upsertOne(1, { name: 'z', companyId: 999 } as Row)

    expect(delegate.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { name: 'z', companyId: 7 },
      update: { name: 'z' }
    })
  })
})

describe('PrismaAdapter.withScope — SQL paths', () => {
  function makeClient() {
    const calls: Array<{ statement: string; parameters: unknown[] }> = []
    const client = {
      $queryRawUnsafe: vi.fn().mockImplementation((statement: string, ...parameters: unknown[]) => {
        calls.push({ statement, parameters })
        // count query first, then rows
        if (/COUNT/i.test(statement)) return Promise.resolve([{ count: 0 }])
        return Promise.resolve([])
      })
    }
    return { client, calls }
  }

  it('executeQueryBuilder AND-s the tenant filter ahead of caller filters', async () => {
    const { client, calls } = makeClient()
    const repo = new PrismaAdapter<Row>({
      delegate: makeDelegate(),
      client,
      tableName: 'rows'
    }).withScope(SCOPE)

    await repo.executeQueryBuilder({
      tableName: 'rows',
      where: [{ field: 'name', comparison: '=', value1: 'a' }]
    })

    // First param is always the tenant value, and the tenant predicate leads the WHERE.
    const countCall = calls.find((c) => /COUNT/i.test(c.statement))!
    expect(countCall.statement).toMatch(/WHERE companyId = \$1 AND \(/)
    expect(countCall.parameters[0]).toBe(7)
  })

  it('a caller OR cannot escape the tenant boundary (filters are parenthesised)', async () => {
    const { client, calls } = makeClient()
    const repo = new PrismaAdapter<Row>({
      delegate: makeDelegate(),
      client,
      tableName: 'rows'
    }).withScope(SCOPE)

    // Attempt: companyId=7 AND ( name='a' OR companyId=999 ) — the OR stays inside the group.
    await repo.executeQueryBuilder({
      tableName: 'rows',
      where: [
        { field: 'name', comparison: '=', value1: 'a', operator: 'OR' },
        { field: 'companyId', comparison: '=', value1: 999 }
      ]
    })

    const selectCall = calls.find((c) => !/COUNT/i.test(c.statement))!
    expect(selectCall.statement).toContain('companyId = $1 AND (')
    expect(selectCall.statement.trim()).toMatch(/\)$|\) /)
    expect(selectCall.parameters[0]).toBe(7)
  })

  it('updateMany scopes the WHERE and strips tenant from the SET payload', async () => {
    const { client, calls } = makeClient()
    const repo = new PrismaAdapter<Row>({
      delegate: makeDelegate(),
      client,
      tableName: 'rows'
    }).withScope(SCOPE)

    await repo.updateMany(
      { tableName: 'rows', where: [{ field: 'name', comparison: '=', value1: 'a' }] },
      { name: 'z', companyId: 999 } as Partial<Row>
    )

    const stmt = calls[0]!.statement
    const setClause = stmt.slice(stmt.indexOf('SET'), stmt.indexOf('WHERE'))
    expect(setClause).toMatch(/name = /)
    expect(setClause).not.toContain('companyId') // tenant stripped from SET
    expect(stmt).toMatch(/WHERE companyId = /)
  })
})

// ─── Router integration: fail-closed behaviour ────────────────────────────────

const MODEL = {
  name: 'Widget',
  fields: [
    { name: 'id', kind: 'scalar', isId: true, isReadOnly: true, hasDefault: true },
    { name: 'companyId', kind: 'scalar', isId: false, isReadOnly: false, hasDefault: false },
    { name: 'name', kind: 'scalar', isId: false, isReadOnly: false, hasDefault: false }
  ]
}

function sessionStrategy(company: unknown): AuthStrategy {
  return {
    authenticate(): AuthContext {
      return { isAuthenticated: true, claims: { company } }
    }
  }
}

function buildApp(opts: { company: unknown; strict?: boolean }) {
  const delegate = makeDelegate()
  const resources = createPrismaResources({ widget: delegate }, [MODEL], {
    tenantField: 'companyId'
  })
  const app = express()
  app.use(express.json())
  app.use(
    '/api/v3',
    createExpressCrudRouter(resources, {
      authStrategy: sessionStrategy(opts.company),
      tenant: {
        resolveId: ({ auth }) => (auth.claims?.company as { id?: number })?.id ?? null,
        ...(opts.strict === undefined ? {} : { strict: opts.strict })
      }
    })
  )
  return { app, delegate, resources }
}

describe('createExpressCrudRouter — tenant integration', () => {
  it('auto-detects companyId and scopes a list request', async () => {
    const { app, delegate } = buildApp({ company: { id: 7 } })

    const res = await request(app).get('/api/v3/widgets')
    expect(res.status).toBe(200)
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 7 } })
    )
  })

  it('marks the auto-detected resource as tenant-scoped', () => {
    const { resources } = buildApp({ company: { id: 7 } })
    expect(resources[0]!.tenant).toEqual({ field: 'companyId' })
  })

  it('fails closed with 403 when no tenant can be resolved (strict default)', async () => {
    const { app, delegate } = buildApp({ company: null })

    const res = await request(app).get('/api/v3/widgets')
    expect(res.status).toBe(403)
    expect(delegate.findMany).not.toHaveBeenCalled()
  })

  it('serves unscoped when strict is explicitly disabled and no tenant resolves', async () => {
    const { app, delegate } = buildApp({ company: null, strict: false })

    const res = await request(app).get('/api/v3/widgets')
    expect(res.status).toBe(200)
    expect(delegate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
  })

  it('refuses at registration when a scoped resource has no withScope support', () => {
    const plainRepo = {
      async getOne() {
        return null
      },
      async getMany() {
        return { count: 0, results: [] }
      },
      async createOne(d: unknown) {
        return d
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
      name: 'Widget',
      routePrefix: 'widgets',
      fields: [{ name: 'id' }, { name: 'companyId' }],
      tenant: { field: 'companyId' },
      repository: plainRepo as never
    }

    expect(() =>
      createExpressCrudRouter([resource], {
        tenant: { resolveId: () => 7 }
      })
    ).toThrow(/withScope/)
  })

  it('does not scope a resource that opts out with tenant:false', async () => {
    const delegate = makeDelegate()
    const resources = createPrismaResources({ widget: delegate }, [MODEL], {
      tenantField: 'companyId',
      models: { Widget: { tenant: false } }
    })
    const app = express()
    app.use(express.json())
    app.use(
      '/api/v3',
      createExpressCrudRouter(resources, {
        authStrategy: sessionStrategy({ id: 7 }),
        tenant: { resolveId: () => 7 }
      })
    )

    await request(app).get('/api/v3/widgets')
    expect(delegate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
  })
})
