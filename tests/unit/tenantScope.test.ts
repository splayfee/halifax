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

describe('PrismaAdapter.withScope — query/bulk paths (delegate)', () => {
  it('executeQuery AND-s the tenant filter ahead of caller filters', async () => {
    const delegate = makeDelegate({
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([])
    })
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    await repo.executeQuery({
      where: [{ field: 'name', comparison: '=', value1: 'a' }]
    })

    // The tenant predicate is AND-ed outside the caller's filters, every time.
    const where = delegate.findMany.mock.calls[0]![0].where
    expect(where).toEqual({ AND: [{ companyId: { equals: 7 } }, { name: { equals: 'a' } }] })
  })

  it('a caller OR cannot escape the tenant boundary (nested under the tenant AND)', async () => {
    const delegate = makeDelegate({
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([])
    })
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    // Attempt: companyId=7 AND ( name='a' OR companyId=999 ) — the OR stays inside the group.
    await repo.executeQuery({
      where: [
        { field: 'name', comparison: '=', value1: 'a', operator: 'OR' },
        { field: 'companyId', comparison: '=', value1: 999 }
      ]
    })

    const where = delegate.findMany.mock.calls[0]![0].where
    expect(where.AND[0]).toEqual({ companyId: { equals: 7 } })
    expect(where.AND[1]).toEqual({
      OR: [{ name: { equals: 'a' } }, { companyId: { equals: 999 } }]
    })
  })

  it('updateMany scopes the WHERE and strips tenant from the payload', async () => {
    const delegate = makeDelegate({
      findMany: vi.fn().mockResolvedValue([{ id: 1 }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    })
    const repo = new PrismaAdapter<Row>({ delegate }).withScope(SCOPE)

    await repo.updateMany({ where: [{ field: 'name', comparison: '=', value1: 'a' }] }, {
      name: 'z',
      companyId: 999
    } as Partial<Row>)

    const call = delegate.updateMany.mock.calls[0]![0]
    expect(call.where).toEqual({ AND: [{ companyId: { equals: 7 } }, { name: { equals: 'a' } }] })
    expect(call.data).toEqual({ name: 'z' }) // tenant field stripped from the payload
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

  it('falls through to auto-detection when resource.tenant has no field property', async () => {
    // resource.tenant is truthy but .field is undefined → branch 3 of effectiveTenantField
    // is NOT taken; falls through to auto-detect by matching field names.
    // The resource has 'companyId' so auto-detection picks it up.
    const delegate = makeDelegate()
    const resource: ResourceDefinition = {
      name: 'Widget',
      routePrefix: 'widgets',
      // tenant is truthy ({}) but .field is absent — exercises the false branch of
      // `resource.tenant && resource.tenant.field` at crudRouter.ts line 126
      tenant: {} as { field: string },
      fields: [{ name: 'id' }, { name: 'companyId' }, { name: 'name' }],
      repository: new PrismaAdapter<Row>({ delegate })
    }

    const app = express()
    app.use(express.json())
    app.use(
      '/api/v3',
      createExpressCrudRouter([resource], {
        authStrategy: sessionStrategy({ id: 7 }),
        tenant: { field: 'companyId', resolveId: () => 7 }
      })
    )

    const res = await request(app).get('/api/v3/widgets')
    expect(res.status).toBe(200)
    // Auto-detection found 'companyId' so the repo is called with the tenant scope
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 7 } })
    )
  })

  it('throws ServerError when the tenant field name contains unsafe characters', () => {
    // Field name 'tenant-id' fails /^[a-zA-Z_][a-zA-Z0-9_]*$/ → crudRouter.ts line 254
    const delegate = makeDelegate()
    const resource: ResourceDefinition = {
      name: 'Widget',
      routePrefix: 'widgets',
      fields: [{ name: 'id' }, { name: 'tenant-id' }, { name: 'name' }],
      repository: new PrismaAdapter<Row>({ delegate })
    }

    expect(() =>
      createExpressCrudRouter([resource], {
        tenant: { field: 'tenant-id', resolveId: () => 7 }
      })
    ).toThrow(/unsafe tenant field name/)
  })
})
