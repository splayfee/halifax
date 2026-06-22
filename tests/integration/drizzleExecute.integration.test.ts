/**
 * DrizzleSqlExecutor integration tests against real databases.
 *
 * Run with: `pnpm test:integration` (selects the engine via `HALIFAX_DB`, needs `DATABASE_URL`).
 * Runs for PostgreSQL, MySQL, and MariaDB — these are the Drizzle dialects that support stored
 * routines. Skipped for SQLite (no routines), SQL Server (no Drizzle driver), and CockroachDB
 * (version-dependent UDF support).
 *
 * Key difference from PrismaSqlExecutor: Drizzle mysql2's `db.execute()` routes through mysql2's
 * text protocol (`client.query()`), NOT the prepared-statement protocol (`client.execute()`).
 * This means `CALL` and `CREATE PROCEDURE` work fine — the error-1295 limitation that blocks
 * Prisma's `@prisma/adapter-mariadb` does not apply here.
 *
 * Each run creates a routine `drizzle_sum_two(a, b)` that returns `{ total: a + b }` and raises
 * an error when `a < 0`, then exercises the full HTTP path through `POST /api/execute/drizzle-sum-two`.
 */

import express from 'express'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDbName } from '../helpers/integrationDb.js'
import {
  DrizzleSqlExecutor,
  type DrizzleDb as DrizzleDbType
} from '@/adapters/orm/drizzle/DrizzleSqlExecutor.js'
import { ExpressHttpServer, registerCrudApi, type ExecuteOptions } from '@/index.js'

type Dialect = 'postgres' | 'mysql'

const DIALECT: Record<string, Dialect | null> = {
  postgres: 'postgres',
  cockroachdb: null,
  mysql: 'mysql',
  mariadb: 'mysql',
  mssql: null,
  sqlite: null,
  mongodb: null
}

const db = integrationDbName()
const dialect = DIALECT[db] ?? null
const runnable = !!process.env.DATABASE_URL && dialect !== null
const PROC = 'drizzle_sum_two'

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
  // mysql / mariadb — db.execute() uses mysql2 text protocol, so CALL and CREATE PROCEDURE work.
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

async function connectDrizzle(d: Dialect): Promise<{ db: DrizzleDbType; close(): Promise<void> }> {
  const url = process.env.DATABASE_URL!
  if (d === 'postgres') {
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const pool = new pg.Pool({ connectionString: url })
    return { db: drizzle(pool), close: () => pool.end() }
  }
  // mysql / mariadb
  const mysql = await import('mysql2/promise')
  const { drizzle } = await import('drizzle-orm/mysql2')
  const conn = await mysql.createConnection(url)
  return { db: drizzle({ client: conn }), close: () => conn.end() }
}

const run = runnable ? describe : describe.skip

run(`DrizzleSqlExecutor — ${db}`, () => {
  let drizzleDb: DrizzleDbType
  let closeDb: () => Promise<void>
  let app: express.Express

  beforeAll(async () => {
    const connected = await connectDrizzle(dialect as Dialect)
    drizzleDb = connected.db
    closeDb = connected.close

    const { sql } = await import('drizzle-orm')
    const { setup } = ddl(dialect as Dialect)
    for (const stmt of setup) await drizzleDb.execute(sql.raw(stmt))

    const execute: ExecuteOptions = {
      executor: new DrizzleSqlExecutor(drizzleDb, { dialect: dialect as Dialect }),
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
    if (!drizzleDb) return
    const { sql } = await import('drizzle-orm')
    const { teardown } = ddl(dialect as Dialect)
    for (const stmt of teardown) await drizzleDb.execute(sql.raw(stmt)).catch(() => undefined)
    await closeDb()
  })

  it('runs the routine and returns its rows', async () => {
    const res = await request(app).post('/api/execute/drizzle-sum-two').send({ a: 2, b: 3 })

    expect(res.status).toBe(200)
    expect(res.body.rowCount).toBe(1)
    expect(Number((res.body.rows[0] as { total: number }).total)).toBe(5)
  })

  it('binds named params positionally regardless of body key order', async () => {
    const res = await request(app).post('/api/execute/drizzle-sum-two').send({ b: 10, a: 4 })

    expect(res.status).toBe(200)
    expect(Number((res.body.rows[0] as { total: number }).total)).toBe(14)
  })

  it('rejects a missing required parameter with 422', async () => {
    const res = await request(app).post('/api/execute/drizzle-sum-two').send({ a: 2 })

    expect(res.status).toBe(422)
    expect(res.body.errors[0].details.fieldErrors[0].path).toBe('b')
  })

  it('rejects a wrong-typed parameter with 422', async () => {
    const res = await request(app)
      .post('/api/execute/drizzle-sum-two')
      .send({ a: 'not-a-number', b: 3 })

    expect(res.status).toBe(422)
  })

  it('returns 404 for an unregistered procedure', async () => {
    const res = await request(app).post('/api/execute/does-not-exist').send({})

    expect(res.status).toBe(404)
  })

  it('surfaces a database error raised inside the routine as 500', async () => {
    const res = await request(app).post('/api/execute/drizzle-sum-two').send({ a: -1, b: 3 })

    expect(res.status).toBe(500)
  })
})
