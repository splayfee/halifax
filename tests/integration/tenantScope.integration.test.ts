/**
 * Full-stack multi-tenancy integration tests: PrismaAdapter scoping + Express + PostgreSQL.
 *
 * Run with: pnpm test:integration
 * Requires DATABASE_URL in .env.test (loaded automatically via dotenv-cli).
 * All tests are skipped when DATABASE_URL is not set.
 *
 * The `Widget` model (tests/integration/prisma/schema.prisma) carries a `companyId` tenant
 * key. Two tenants — COMPANY_A and COMPANY_B — are exercised against a real database to prove
 * that scoping confines every operation to a single tenant.
 */

import { connectIntegrationDb, missingId } from '../helpers/integrationDb.js'
import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ApiKeyAuthStrategy,
  PrismaAdapter,
  createExpressCrudRouter,
  type IQueryOptions,
  type ResourceDefinition
} from '@/index.js'

const hasDb = !!process.env.DATABASE_URL
const API_KEY = 'test-secret'
const COMPANY_A = 100
const COMPANY_B = 200

// ---------------------------------------------------------------------------
// Lightweight entity types matching the Prisma-generated Widget shape.
// Typed here to avoid `any` while still compiling before
// `pnpm test:integration:generate` has run.
// ---------------------------------------------------------------------------

type Widget = {
  id: number | string
  name: string
  companyId: number
}

type WidgetListBody = { count: number; results: Widget[] }
type WidgetBody = { companyId: number; name: string; id: number | string }

/** Typed view of the Prisma client returned by `connectIntegrationDb()`. */
type PrismaClient = Awaited<ReturnType<typeof connectIntegrationDb>> & {
  widget: {
    deleteMany(args?: unknown): Promise<{ count: number }>
    createMany(args: { data: unknown[] }): Promise<{ count: number }>
    create(args: { data: unknown }): Promise<Widget>
    findUnique(args: { where: unknown }): Promise<Widget | null>
    findMany(args?: unknown): Promise<Widget[]>
    count(args?: unknown): Promise<number>
    update(args: unknown): Promise<Widget>
    delete(args: unknown): Promise<unknown>
  }
}

// ---------------------------------------------------------------------------
// Suite 1: PrismaAdapter.withScope — direct (no HTTP), against a real database
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)('PrismaAdapter.withScope — direct (real DB)', () => {
  let prisma: PrismaClient
  let base: PrismaAdapter
  let repoA: PrismaAdapter
  let repoB: PrismaAdapter

  beforeAll(async () => {
    prisma = (await connectIntegrationDb()) as PrismaClient
    await prisma.$connect()
    base = new PrismaAdapter({ delegate: prisma.widget })
    repoA = base.withScope({ field: 'companyId', value: COMPANY_A })
    repoB = base.withScope({ field: 'companyId', value: COMPANY_B })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.widget.deleteMany()
  })

  // ---- reads ----

  it('getMany returns only the caller-tenant rows', async () => {
    await prisma.widget.createMany({
      data: [
        { companyId: COMPANY_A, name: 'a1' },
        { companyId: COMPANY_A, name: 'a2' },
        { companyId: COMPANY_B, name: 'b1' }
      ]
    })

    const a = await repoA.getMany()
    expect(a.count).toBe(2)
    expect((a.results as Widget[]).every((r) => r.companyId === COMPANY_A)).toBe(true)

    const b = await repoB.getMany()
    expect(b.count).toBe(1)
  })

  it('getMany ignores a caller-supplied tenant value (no spoofing)', async () => {
    await prisma.widget.createMany({
      data: [
        { companyId: COMPANY_A, name: 'a1' },
        { companyId: COMPANY_B, name: 'b1' }
      ]
    })
    // Caller asks for company B while scoped to A — scope wins.
    const { count, results } = await repoA.getMany({ where: { companyId: COMPANY_B } })
    expect(count).toBe(1)
    expect((results[0] as Widget).companyId).toBe(COMPANY_A)
  })

  it('getOne returns the row for the owning tenant but null cross-tenant', async () => {
    const owned = await prisma.widget.create({
      data: { companyId: COMPANY_A, name: 'owned' }
    })

    expect(((await repoA.getOne(owned.id)) as Widget | null)?.name).toBe('owned')
    expect(await repoB.getOne(owned.id)).toBeNull()
  })

  // ---- writes ----

  it('createOne stamps the tenant, overriding any value in the payload', async () => {
    const created = (await repoA.createOne({
      name: 'stamped',
      companyId: COMPANY_B // attempt to plant into another tenant
    } as Record<string, unknown>)) as Widget

    expect(created.companyId).toBe(COMPANY_A)
    const row = await prisma.widget.findUnique({ where: { id: created.id } })
    expect(row?.companyId).toBe(COMPANY_A)
  })

  it('createMany stamps every row with the caller tenant', async () => {
    await repoA.createMany([{ name: 'm1' }, { name: 'm2', companyId: COMPANY_B }] as Array<
      Record<string, unknown>
    >)
    const rows = await prisma.widget.findMany()
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.companyId === COMPANY_A)).toBe(true)
  })

  it('updateOne updates an owned row and cannot move it to another tenant', async () => {
    const owned = await prisma.widget.create({
      data: { companyId: COMPANY_A, name: 'before' }
    })

    const updated = (await repoA.updateOne(owned.id, {
      name: 'after',
      companyId: COMPANY_B // attempt to reassign tenant
    } as Record<string, unknown>)) as Widget | null

    expect(updated?.name).toBe('after')
    expect(updated?.companyId).toBe(COMPANY_A) // tenant field stripped from the payload
  })

  it('updateOne returns null for a row owned by another tenant (no write)', async () => {
    const owned = await prisma.widget.create({
      data: { companyId: COMPANY_A, name: 'before' }
    })

    expect(
      await repoB.updateOne(owned.id, { name: 'hacked' } as Record<string, unknown>)
    ).toBeNull()
    const row = await prisma.widget.findUnique({ where: { id: owned.id } })
    expect(row?.name).toBe('before')
  })

  it('deleteOne removes an owned row but is a no-op cross-tenant', async () => {
    const owned = await prisma.widget.create({
      data: { companyId: COMPANY_A, name: 'x' }
    })

    expect(await repoB.deleteOne(owned.id)).toBe(false)
    expect(await prisma.widget.findUnique({ where: { id: owned.id } })).not.toBeNull()

    expect(await repoA.deleteOne(owned.id)).toBe(true)
    expect(await prisma.widget.findUnique({ where: { id: owned.id } })).toBeNull()
  })

  it('upsertOne refuses to overwrite a row owned by another tenant', async () => {
    const owned = await prisma.widget.create({
      data: { companyId: COMPANY_A, name: 'owned' }
    })

    await expect(
      repoB.upsertOne!(owned.id, { name: 'hijacked' } as Record<string, unknown>)
    ).rejects.toMatchObject({ status: 409 })

    const row = await prisma.widget.findUnique({ where: { id: owned.id } })
    expect(row?.name).toBe('owned')
    expect(row?.companyId).toBe(COMPANY_A)
  })

  it('upsertOne stamps the tenant when creating a new row', async () => {
    // Key comes from the first arg, not the payload — see the note in prismaExpress upsert tests.
    const created = (await repoA.upsertOne!(missingId(), {
      name: 'fresh',
      companyId: COMPANY_B
    } as Record<string, unknown>)) as Widget
    expect(created.companyId).toBe(COMPANY_A)
  })

  // ---- bulk SQL paths ----

  it('executeQuery only returns rows for the caller tenant', async () => {
    await prisma.widget.createMany({
      data: [
        { companyId: COMPANY_A, name: 'shared' },
        { companyId: COMPANY_B, name: 'shared' }
      ]
    })

    const result = await repoA.executeQuery!({
      where: [{ field: 'name', comparison: '=', value1: 'shared' }]
    } satisfies IQueryOptions)

    expect(result.count).toBe(1)
    expect(result.results).toHaveLength(1)
  })

  it('a caller OR cannot escape the tenant boundary in the query builder', async () => {
    await prisma.widget.createMany({
      data: [
        { companyId: COMPANY_A, name: 'only-a' },
        { companyId: COMPANY_B, name: 'only-b' },
        { companyId: COMPANY_B, name: 'lure' }
      ]
    })

    // Scoped to A, attempt: name='only-a' OR companyId=B. The OR is parenthesised under the
    // tenant predicate, so company B rows can never be reached.
    const result = await repoA.executeQuery!({
      where: [
        { field: 'name', comparison: '=', value1: 'only-a', operator: 'OR' },
        { field: 'companyId', comparison: '=', value1: COMPANY_B }
      ]
    } satisfies IQueryOptions)

    expect(result.count).toBe(1)
    expect((result.results as Widget[]).every((r) => r.companyId === COMPANY_A)).toBe(true)
  })

  it('updateMany only affects the caller-tenant rows', async () => {
    await prisma.widget.createMany({
      data: [
        { companyId: COMPANY_A, name: 'old' },
        { companyId: COMPANY_A, name: 'old' },
        { companyId: COMPANY_B, name: 'old' }
      ]
    })

    const result = await repoA.updateMany!(
      {
        where: [{ field: 'name', comparison: '=', value1: 'old' }]
      } satisfies IQueryOptions,
      { name: 'new', companyId: COMPANY_B } as Record<string, unknown> // tenant change attempt
    )

    expect(result.updated).toHaveLength(2)
    // Company B row untouched; both A rows renamed but still in company A.
    expect(await prisma.widget.count({ where: { name: 'new', companyId: COMPANY_A } })).toBe(2)
    expect(await prisma.widget.count({ where: { companyId: COMPANY_B, name: 'old' } })).toBe(1)
    expect(await prisma.widget.count({ where: { companyId: COMPANY_B } })).toBe(1)
  })

  it('deleteMany only removes the caller-tenant rows', async () => {
    await prisma.widget.createMany({
      data: [
        { companyId: COMPANY_A, name: 'gone' },
        { companyId: COMPANY_B, name: 'gone' }
      ]
    })

    const result = await repoA.deleteMany!({
      where: [{ field: 'name', comparison: '=', value1: 'gone' }]
    } satisfies IQueryOptions)

    expect(result.deleted).toHaveLength(1)
    expect(await prisma.widget.count()).toBe(1)
    expect(await prisma.widget.count({ where: { companyId: COMPANY_B } })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Suite 2: HTTP layer — tenant resolved per request, against a real database
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)('Express tenant scoping — HTTP layer (real DB)', () => {
  let prisma: PrismaClient
  let app: ReturnType<typeof express>

  function buildApp(strict?: boolean) {
    const widget: ResourceDefinition = {
      name: 'Widget',
      routePrefix: 'widgets',
      tenant: { field: 'companyId' },
      fields: [
        { name: 'id', filterable: true, sortable: true },
        { name: 'companyId', filterable: true, writable: true },
        { name: 'name', filterable: true, sortable: true, writable: true }
      ],
      repository: new PrismaAdapter({
        delegate: prisma.widget
      })
    }

    const application = express()
    application.use(express.json())
    application.use(
      '/api/v3',
      createExpressCrudRouter([widget], {
        authStrategy: new ApiKeyAuthStrategy(API_KEY),
        tenant: {
          // The tenant key comes from the request context, not the body. Here we read a
          // header; a real app would read it from the authenticated session/token.
          resolveId: ({ req }) => {
            const raw = req.headers['x-company-id']
            const value = Array.isArray(raw) ? raw[0] : raw
            return value ? Number(value) : null
          },
          ...(strict === undefined ? {} : { strict })
        }
      })
    )
    return application
  }

  function as(company: number) {
    return { 'x-api-key': API_KEY, 'x-company-id': String(company) }
  }

  beforeAll(async () => {
    prisma = (await connectIntegrationDb()) as PrismaClient
    await prisma.$connect()
    app = buildApp()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.widget.deleteMany()
  })

  it('GET list returns only the calling tenant rows', async () => {
    await prisma.widget.createMany({
      data: [
        { companyId: COMPANY_A, name: 'a1' },
        { companyId: COMPANY_B, name: 'b1' },
        { companyId: COMPANY_B, name: 'b2' }
      ]
    })

    const a = await request(app).get('/api/v3/widgets').set(as(COMPANY_A))
    expect(a.status).toBe(200)
    expect((a.body as WidgetListBody).count).toBe(1)

    const b = await request(app).get('/api/v3/widgets').set(as(COMPANY_B))
    expect((b.body as WidgetListBody).count).toBe(2)
  })

  it('GET /:id is 404 across tenants', async () => {
    const owned = await prisma.widget.create({
      data: { companyId: COMPANY_A, name: 'owned' }
    })

    expect((await request(app).get(`/api/v3/widgets/${owned.id}`).set(as(COMPANY_A))).status).toBe(
      200
    )
    expect((await request(app).get(`/api/v3/widgets/${owned.id}`).set(as(COMPANY_B))).status).toBe(
      404
    )
  })

  it('POST stamps the calling tenant and ignores a spoofed companyId in the body', async () => {
    const res = await request(app)
      .post('/api/v3/widgets')
      .set(as(COMPANY_A))
      .send({ name: 'created', companyId: COMPANY_B })

    expect(res.status).toBe(201)
    expect((res.body as WidgetBody).companyId).toBe(COMPANY_A)
    // Not visible to company B.
    expect(
      ((await request(app).get('/api/v3/widgets').set(as(COMPANY_B))).body as WidgetListBody).count
    ).toBe(0)
  })

  it('PATCH /:id cannot modify another tenant row (404)', async () => {
    const owned = await prisma.widget.create({
      data: { companyId: COMPANY_A, name: 'before' }
    })

    const res = await request(app)
      .patch(`/api/v3/widgets/${owned.id}`)
      .set(as(COMPANY_B))
      .send({ name: 'hacked' })

    expect(res.status).toBe(404)
    expect((await prisma.widget.findUnique({ where: { id: owned.id } }))?.name).toBe('before')
  })

  it('DELETE /:id cannot remove another tenant row (404)', async () => {
    const owned = await prisma.widget.create({
      data: { companyId: COMPANY_A, name: 'x' }
    })

    expect(
      (await request(app).delete(`/api/v3/widgets/${owned.id}`).set(as(COMPANY_B))).status
    ).toBe(404)
    expect(await prisma.widget.findUnique({ where: { id: owned.id } })).not.toBeNull()
  })

  it('POST /query-builder is confined to the calling tenant', async () => {
    await prisma.widget.createMany({
      data: [
        { companyId: COMPANY_A, name: 'shared' },
        { companyId: COMPANY_B, name: 'shared' }
      ]
    })

    const res = await request(app)
      .post('/api/v3/widgets/query')
      .set(as(COMPANY_A))
      .send({ where: [{ field: 'name', comparison: '=', value1: 'shared' }] })

    expect(res.status).toBe(200)
    expect((res.body as WidgetListBody).count).toBe(1)
  })

  it('fails closed with 403 when no tenant can be resolved (strict default)', async () => {
    await prisma.widget.create({ data: { companyId: COMPANY_A, name: 'a1' } })
    const res = await request(app).get('/api/v3/widgets').set('x-api-key', API_KEY) // no x-company-id
    expect(res.status).toBe(403)
  })

  it('serves unscoped when strict is explicitly disabled and no tenant resolves', async () => {
    const lenient = buildApp(false)
    await prisma.widget.createMany({
      data: [
        { companyId: COMPANY_A, name: 'a1' },
        { companyId: COMPANY_B, name: 'b1' }
      ]
    })
    const res = await request(lenient).get('/api/v3/widgets').set('x-api-key', API_KEY)
    expect(res.status).toBe(200)
    expect((res.body as WidgetListBody).count).toBe(2)
  })
})
