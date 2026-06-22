/**
 * SequelizeSqlExecutor integration tests against real databases.
 *
 * Run with: `pnpm test:integration` (selects the engine via `HALIFAX_DB`, needs `DATABASE_URL`).
 * Runs for PostgreSQL, MySQL, MariaDB, and SQL Server — the Sequelize dialects that support stored
 * routines. Skipped for SQLite (no routines) and CockroachDB (out of Sequelize scope).
 *
 * Unlike PrismaSqlExecutor, the MySQL/MariaDB path uses Sequelize `replacements` (text protocol),
 * so `CALL` works without the prepared-statement error-1295 restriction.
 *
 * Each run creates a routine `seq_sum_two(a, b)` that returns `{ total: a + b }` and raises
 * an error when `a < 0`, then exercises the full HTTP path through
 * `POST /api/execute/seq-sum-two`.
 */

import express from 'express'
import request from 'supertest'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDbName } from '../helpers/integrationDb.js'
import { SequelizeSqlExecutor, type SequelizeSqlDialect } from '@/adapters/orm/sequelize/SequelizeSqlExecutor.js'
import { ExpressHttpServer, registerCrudApi, type ExecuteOptions } from '@/index.js'

type RunDialect = SequelizeSqlDialect

const DIALECT: Record<string, RunDialect | null> = {
  postgres:    'postgres',
  cockroachdb: null,  // CockroachDB quirks outside Sequelize test scope
  mysql:       'mysql',
  mariadb:     'mysql',
  mssql:       'mssql',
  sqlite:      null,  // no stored routines
}

const db = integrationDbName()
const dialect = DIALECT[db] ?? null
const runnable = !!process.env.DATABASE_URL && dialect !== null

const PROC = 'seq_sum_two'

function ddl(d: RunDialect): { setup: string[]; teardown: string[] } {
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
      `IF OBJECT_ID('dbo.${PROC}', 'P') IS NOT NULL DROP PROCEDURE dbo.${PROC}`,
      `CREATE PROCEDURE dbo.${PROC} @a INT, @b INT AS
       BEGIN
         IF @a < 0 THROW 50000, 'negative not allowed', 1;
         SELECT @a + @b AS total;
       END`
    ],
    teardown: [
      `IF OBJECT_ID('dbo.${PROC}', 'P') IS NOT NULL DROP PROCEDURE dbo.${PROC}`
    ]
  }
}

function makeSequelize(d: RunDialect): Sequelize {
  const url = process.env.DATABASE_URL!
  if (d === 'postgres') return new Sequelize(url, { dialect: 'postgres', logging: false })
  if (d === 'mysql') return new Sequelize(url, { dialect: 'mysql', logging: false })
  // mssql — Sequelize expects host/port/user/pass/database config, not a JDBC URL.
  // Parse the sqlserver:// URL into a Sequelize options object.
  const [hostPart = '', ...kvParts] = url.replace(/^sqlserver:\/\//, '').split(';')
  const [host, portStr] = hostPart.split(':')
  const params = new Map<string, string>()
  for (const kv of kvParts) {
    const eq = kv.indexOf('=')
    if (eq > 0) params.set(kv.slice(0, eq).toLowerCase(), kv.slice(eq + 1))
  }
  return new Sequelize({
    dialect: 'mssql',
    host,
    port: portStr ? Number(portStr) : 1433,
    database: params.get('database') ?? 'master',
    username: params.get('user') ?? '',
    password: params.get('password') ?? '',
    logging: false,
    dialectOptions: { options: { trustServerCertificate: params.get('trustservercertificate') === 'true' } }
  })
}

const run = runnable ? describe : describe.skip

run(`SequelizeSqlExecutor — ${db}`, () => {
  let sequelize: Sequelize
  let app: express.Express

  beforeAll(async () => {
    sequelize = makeSequelize(dialect as RunDialect)
    await sequelize.authenticate()

    const { setup } = ddl(dialect as RunDialect)
    for (const stmt of setup) await sequelize.query(stmt)

    const execute: ExecuteOptions = {
      executor: new SequelizeSqlExecutor(sequelize, { dialect: dialect as RunDialect }),
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
    if (!sequelize) return
    const { teardown } = ddl(dialect as RunDialect)
    for (const stmt of teardown) await sequelize.query(stmt).catch(() => undefined)
    await sequelize.close()
  })

  it('runs the routine and returns its rows', async () => {
    const res = await request(app).post('/api/execute/seq-sum-two').send({ a: 2, b: 3 })

    expect(res.status).toBe(200)
    expect(res.body.rowCount).toBe(1)
    expect(Number((res.body.rows[0] as { total: number }).total)).toBe(5)
  })

  it('binds named params positionally regardless of body key order', async () => {
    const res = await request(app).post('/api/execute/seq-sum-two').send({ b: 10, a: 4 })

    expect(res.status).toBe(200)
    expect(Number((res.body.rows[0] as { total: number }).total)).toBe(14)
  })

  it('rejects a missing required parameter with 422', async () => {
    const res = await request(app).post('/api/execute/seq-sum-two').send({ a: 2 })

    expect(res.status).toBe(422)
    expect(res.body.errors[0].details.fieldErrors[0].path).toBe('b')
  })

  it('rejects a wrong-typed parameter with 422', async () => {
    const res = await request(app)
      .post('/api/execute/seq-sum-two')
      .send({ a: 'not-a-number', b: 3 })

    expect(res.status).toBe(422)
  })

  it('returns 404 for an unregistered procedure', async () => {
    const res = await request(app).post('/api/execute/does-not-exist').send({})

    expect(res.status).toBe(404)
  })

  it('surfaces a database error raised inside the routine as 500', async () => {
    const res = await request(app).post('/api/execute/seq-sum-two').send({ a: -1, b: 3 })

    expect(res.status).toBe(500)
  })
})
