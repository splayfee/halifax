/**
 * Full-stack integration tests for the stored-procedure (`execute`) feature against a REAL database.
 *
 * Run with: `pnpm test:integration` (selects the engine via `HALIFAX_DB`, needs `DATABASE_URL`).
 * Skipped unless `DATABASE_URL` is set AND the selected engine supports stored procedures
 * (PostgreSQL, MySQL, MariaDB, SQL Server). SQLite/Mongo/CockroachDB are skipped — SQLite/Mongo have
 * no stored routines, and CockroachDB's routine support is version-dependent.
 *
 * Each run creates a routine `halifax_sum_two(a, b)` that returns `{ total: a + b }` and raises an
 * error when `a < 0`, then exercises the full HTTP path through `POST /api/execute/halifax-sum-two`.
 */

import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectIntegrationDb, integrationDbName } from '../helpers/integrationDb.js'
import {
  ExpressHttpServer,
  PrismaSqlExecutor,
  registerCrudApi,
  type ExecuteOptions
} from '@/index.js'

type RawClient = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $connect(): Promise<void>
  $disconnect(): Promise<void>
  _activeProvider?: string
}

type Dialect = 'postgres' | 'mysql' | 'mssql'

// Map the selected engine to the executor dialect, or null when the feature doesn't apply.
const DIALECT: Record<string, Dialect | null> = {
  postgres: 'postgres',
  cockroachdb: null,
  mysql: 'mysql',
  mariadb: 'mysql',
  mssql: 'mssql',
  sqlite: null,
  mongodb: null
}

const db = integrationDbName()
const dialect = DIALECT[db] ?? null
const runnable = !!process.env.DATABASE_URL && dialect !== null
const PROC = 'halifax_sum_two'

/** Per-dialect DDL: setup statements (run in order) and teardown statements. */
function ddl(d: Dialect): { setup: string[]; teardown: string[] } {
  if (d === 'postgres') {
    return {
      setup: [
        `DROP FUNCTION IF EXISTS ${PROC}(integer, integer)`,
        `CREATE FUNCTION ${PROC}(a integer, b integer)
         RETURNS TABLE(total integer)
         LANGUAGE plpgsql AS $$
         BEGIN
           IF a < 0 THEN RAISE EXCEPTION 'negative not allowed'; END IF;
           RETURN QUERY SELECT a + b;
         END; $$`
      ],
      teardown: [`DROP FUNCTION IF EXISTS ${PROC}(integer, integer)`]
    }
  }
  if (d === 'mysql') {
    return {
      setup: [
        `DROP PROCEDURE IF EXISTS ${PROC}`,
        `CREATE PROCEDURE ${PROC}(IN a INT, IN b INT)
         BEGIN
           IF a < 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'negative not allowed'; END IF;
           SELECT a + b AS total;
         END`
      ],
      teardown: [`DROP PROCEDURE IF EXISTS ${PROC}`]
    }
  }
  // mssql
  return {
    setup: [
      `CREATE OR ALTER PROCEDURE ${PROC} @a INT, @b INT AS
       BEGIN
         IF @a < 0 THROW 50000, 'negative not allowed', 1;
         SELECT @a + @b AS total;
       END`
    ],
    teardown: [`DROP PROCEDURE IF EXISTS ${PROC}`]
  }
}

const run = runnable ? describe : describe.skip

run(`execute (stored procedures) — ${db}`, () => {
  let prisma: RawClient
  let app: express.Express

  beforeAll(async () => {
    prisma = (await connectIntegrationDb()) as unknown as RawClient
    const { setup } = ddl(dialect as Dialect)
    for (const stmt of setup) await prisma.$executeRawUnsafe(stmt)

    const execute: ExecuteOptions = {
      executor: new PrismaSqlExecutor(prisma, { dialect: dialect as Dialect }),
      procedures: [
        {
          name: PROC,
          params: [
            { name: 'a', type: 'number', required: true },
            { name: 'b', type: 'number', required: true }
          ]
        }
      ]
    }

    const router = express.Router()
    registerCrudApi(new ExpressHttpServer(router), [], { execute })
    app = express()
    app.use(express.json())
    app.use('/api', router)
  })

  afterAll(async () => {
    if (!prisma) return
    const { teardown } = ddl(dialect as Dialect)
    for (const stmt of teardown) await prisma.$executeRawUnsafe(stmt).catch(() => undefined)
    await prisma.$disconnect()
  })

  // ── Happy path ──────────────────────────────────────────────────────────────
  it('runs the procedure and returns its rows', async () => {
    const res = await request(app).post('/api/execute/halifax-sum-two').send({ a: 2, b: 3 })

    expect(res.status).toBe(200)
    expect(res.body.rowCount).toBe(1)
    expect(Number((res.body.rows[0] as { total: number }).total)).toBe(5)
  })

  it('binds named params positionally regardless of body key order', async () => {
    const res = await request(app).post('/api/execute/halifax-sum-two').send({ b: 10, a: 4 })

    expect(res.status).toBe(200)
    expect(Number((res.body.rows[0] as { total: number }).total)).toBe(14)
  })

  // ── Sad paths ───────────────────────────────────────────────────────────────
  it('rejects a missing required parameter with 422 (never touches the DB)', async () => {
    const res = await request(app).post('/api/execute/halifax-sum-two').send({ a: 2 })

    expect(res.status).toBe(422)
    expect(res.body.errors[0].details.fieldErrors[0].path).toBe('b')
  })

  it('rejects a wrong-typed parameter with 422', async () => {
    const res = await request(app)
      .post('/api/execute/halifax-sum-two')
      .send({ a: 'not-a-number', b: 3 })

    expect(res.status).toBe(422)
  })

  it('returns 404 for a procedure that was never registered', async () => {
    const res = await request(app).post('/api/execute/does-not-exist').send({})

    expect(res.status).toBe(404)
  })

  it('surfaces a database error raised inside the procedure as 500', async () => {
    // a < 0 makes the routine RAISE/THROW; the executor rethrows and Halifax serializes a 500.
    const res = await request(app).post('/api/execute/halifax-sum-two').send({ a: -1, b: 3 })

    expect(res.status).toBe(500)
  })
})
