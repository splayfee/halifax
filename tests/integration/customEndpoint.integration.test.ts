/**
 * Integration test: HalifaxApi.addCustomEndpoint with a GROUP BY + HAVING query.
 *
 * Demonstrates registering a custom aggregation endpoint that cannot be expressed
 * through Halifax's standard CRUD operations. The endpoint groups sale_records by
 * category and filters out categories whose total sales fall below a threshold —
 * a classic GROUP BY + HAVING pattern.
 *
 * Run with: pnpm test:integration
 * Requires DATABASE_URL in .env.test. Skipped automatically when absent.
 */

import express, { Router } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import { ExpressHttpServer } from '@/adapters/http/ExpressAdapter.js'
import { registerCrudApi } from '@/core/crudRouter.js'
import { ServerError } from '@/errors/ServerError.js'
import { connectIntegrationDb } from '../helpers/integrationDb.js'

const API_KEY = 'integration-test-key'
const hasDb = !!process.env.DATABASE_URL

// ─── Prisma delegate types (structural — avoids needing generated client) ─────

type SaleRecordDelegate = {
  deleteMany(opts?: unknown): Promise<{ count: number }>
  createMany(opts: { data: unknown[] }): Promise<{ count: number }>
  groupBy(opts: {
    by: string[]
    _count?: Record<string, boolean>
    _sum?: Record<string, boolean>
    having?: unknown
    orderBy?: unknown
  }): Promise<Array<Record<string, unknown>>>
}

type PrismaForTest = Awaited<ReturnType<typeof connectIntegrationDb>> & {
  saleRecord: SaleRecordDelegate
}

// ─── Expected response shape ───────────────────────────────────────────────────

type SalesSummaryRow = {
  category: string
  count: number
  total: number
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)('addCustomEndpoint — GROUP BY + HAVING integration', () => {
  let prisma: PrismaForTest
  let app: ReturnType<typeof express>

  beforeAll(async () => {
    prisma = (await connectIntegrationDb()) as PrismaForTest

    app = express()
    app.use(express.json())

    // Use a Router (not the full Express app) — consistent with ExpressAppLike expectations.
    const router = Router()
    const server = new ExpressHttpServer(router)
    const api = registerCrudApi(server, [], {
      authStrategy: new ApiKeyAuthStrategy(API_KEY)
    })
    app.use(router)

    // Custom endpoint: aggregates sale_records via GROUP BY category HAVING SUM(amount) >= minTotal.
    // This is the kind of query Halifax's standard CRUD cannot express — it requires aggregate
    // filtering that only makes sense at the application layer with direct DB access.
    api.addCustomEndpoint(
      'GET',
      '/reports/sales-summary',
      [],
      async (req, res) => {
        const minTotal = Number(req.query['minTotal'] ?? 0)

        const rows = await prisma.saleRecord.groupBy({
          by: ['category'],
          _count: { id: true },
          _sum: { amount: true },
          having: {
            amount: { _sum: { gte: minTotal } }
          },
          orderBy: { _sum: { amount: 'desc' } }
        })

        const result: SalesSummaryRow[] = rows.map((r) => ({
          category: r['category'] as string,
          count: r['_count'] ? (r['_count'] as Record<string, number>)['id'] ?? 0 : 0,
          total: r['_sum'] ? (r['_sum'] as Record<string, number>)['amount'] ?? 0 : 0
        }))

        await res.status(200).json(result)
      },
      {
        summary: 'Sales summary grouped by category',
        description:
          'Groups sale_records by category and returns total sales and record count for each. ' +
          'Use ?minTotal=<number> to filter out categories below a revenue threshold.',
        tags: ['Reports'],
        parameters: [
          {
            name: 'minTotal',
            in: 'query',
            description: 'Minimum total sales amount (HAVING clause threshold).',
            schema: { type: 'number' }
          }
        ],
        responses: {
          '200': {
            description: 'Array of category sales summaries',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      category: { type: 'string' },
                      count: { type: 'integer' },
                      total: { type: 'number' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    )
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.saleRecord.deleteMany()
  })

  // ─── Core GROUP BY + HAVING behaviour ──────────────────────────────────────

  it('returns all categories when minTotal is 0', async () => {
    await prisma.saleRecord.createMany({
      data: [
        { category: 'Electronics', amount: 120 },
        { category: 'Books', amount: 25 },
        { category: 'Clothing', amount: 200 }
      ]
    })

    const res = await request(app)
      .get('/reports/sales-summary?minTotal=0')
      .set('x-api-key', API_KEY)

    expect(res.status).toBe(200)
    const body = res.body as SalesSummaryRow[]
    const categories = body.map((r) => r.category).sort()
    expect(categories).toEqual(['Books', 'Clothing', 'Electronics'])
  })

  it('applies HAVING threshold — only returns categories above minTotal', async () => {
    await prisma.saleRecord.createMany({
      data: [
        { category: 'Electronics', amount: 120 },
        { category: 'Electronics', amount: 80 },
        { category: 'Books', amount: 30 },
        { category: 'Books', amount: 15 },
        { category: 'Clothing', amount: 200 }
      ]
    })
    // Electronics total = 200 ✓, Books total = 45 ✗, Clothing total = 200 ✓

    const res = await request(app)
      .get('/reports/sales-summary?minTotal=100')
      .set('x-api-key', API_KEY)

    expect(res.status).toBe(200)
    const body = res.body as SalesSummaryRow[]
    const categories = body.map((r) => r.category).sort()
    expect(categories).toEqual(['Clothing', 'Electronics'])
    expect(body.find((r) => r.category === 'Books')).toBeUndefined()
  })

  it('returns correct aggregated count and total per category', async () => {
    await prisma.saleRecord.createMany({
      data: [
        { category: 'Gadgets', amount: 50 },
        { category: 'Gadgets', amount: 75 },
        { category: 'Gadgets', amount: 25 }
      ]
    })

    const res = await request(app)
      .get('/reports/sales-summary?minTotal=0')
      .set('x-api-key', API_KEY)

    expect(res.status).toBe(200)
    const body = res.body as SalesSummaryRow[]
    const gadgets = body.find((r) => r.category === 'Gadgets')
    expect(gadgets).toBeDefined()
    expect(gadgets!.count).toBe(3)
    expect(gadgets!.total).toBeCloseTo(150, 5)
  })

  it('returns an empty array when no categories meet the threshold', async () => {
    await prisma.saleRecord.createMany({
      data: [
        { category: 'Trinkets', amount: 5 },
        { category: 'Trinkets', amount: 10 }
      ]
    })

    const res = await request(app)
      .get('/reports/sales-summary?minTotal=9999')
      .set('x-api-key', API_KEY)

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns an empty array when the table is empty', async () => {
    const res = await request(app)
      .get('/reports/sales-summary?minTotal=0')
      .set('x-api-key', API_KEY)

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('treats missing minTotal param as 0 (no threshold)', async () => {
    await prisma.saleRecord.createMany({
      data: [{ category: 'Solo', amount: 1 }]
    })

    const res = await request(app)
      .get('/reports/sales-summary')
      .set('x-api-key', API_KEY)

    expect(res.status).toBe(200)
    expect((res.body as SalesSummaryRow[]).length).toBe(1)
  })

  // ─── Auth enforcement ───────────────────────────────────────────────────────

  it('returns 401 when the API key is missing', async () => {
    const res = await request(app).get('/reports/sales-summary')
    expect(res.status).toBe(401)
  })

  it('returns 403 when the API key is wrong', async () => {
    const res = await request(app)
      .get('/reports/sales-summary')
      .set('x-api-key', 'bad-key')
    expect(res.status).toBe(403)
  })

  // ─── Duplicate registration guard ───────────────────────────────────────────

  it('throws ServerError when addCustomEndpoint is called twice for the same route', () => {
    const innerRouter = Router()
    const innerServer = new ExpressHttpServer(innerRouter)
    const api = registerCrudApi(innerServer, [], {
      authStrategy: new ApiKeyAuthStrategy(API_KEY)
    })

    api.addCustomEndpoint('GET', '/reports/dup', [], async (_req, res) => {
      await res.status(200).json({})
    })

    expect(() =>
      api.addCustomEndpoint('GET', '/reports/dup', [], async (_req, res) => {
        await res.status(200).json({})
      })
    ).toThrow(ServerError)
  })
})
