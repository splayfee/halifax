/**
 * Sequelize adapter integration tests.
 *
 * Suite 1 (always runs): Full repository contract against an in-memory SQLite database.
 *   No DATABASE_URL needed — validates CRUD + query operators + tenant isolation without Docker.
 *
 * Suite 2 (matrix, conditional): Runs when HALIFAX_DB ∈ {postgres, mysql, mariadb, mssql, sqlite}
 *   and DATABASE_URL is set. Skipped for CockroachDB (out of scope) and MongoDB (no support).
 *   Uses table `posts_seq` (not `posts`) to avoid clobbering the Prisma-managed table.
 */

import { DataTypes, Sequelize } from 'sequelize'
import { afterAll, beforeAll, describe } from 'vitest'
import { SequelizeAdapter } from '@/adapters/orm/sequelize/SequelizeAdapter.js'
import type { SeqModel } from '@/adapters/orm/sequelize/SequelizeAdapter.js'
import { runRepositoryContract } from '../helpers/repositoryContract.js'
import { integrationDbName } from '../helpers/integrationDb.js'

// Matches the schema expected by runRepositoryContract
type Post = {
  id: number
  title: string
  content: string | null
  published: boolean
  tenantId: string | null
}

/** Defines the `posts_seq` model on any Sequelize instance. */
function definePostModel(sequelize: Sequelize) {
  return sequelize.define(
    'Post',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
      content: { type: DataTypes.TEXT, allowNull: true },
      published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      tenantId: { type: DataTypes.STRING, allowNull: true }
    },
    { tableName: 'posts_seq', timestamps: false }
  )
}

// ─── Suite 1: In-memory SQLite (always runs) ─────────────────────────────────

runRepositoryContract('SequelizeAdapter (SQLite in-memory)', async () => {
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
  const PostModel = definePostModel(sequelize)
  await sequelize.sync({ force: true })

  const repo = new SequelizeAdapter<Post, Omit<Post, 'id'>, Partial<Post>>(
    PostModel as unknown as SeqModel
  )

  return {
    repo,
    cleanup: async () => {
      await PostModel.destroy({ where: {} })
    },
    teardown: async () => {
      await sequelize.close()
    }
  }
})

// ─── Suite 2: Matrix integration tests ───────────────────────────────────────

const DIALECT: Record<string, string | null> = {
  postgres: 'postgres',
  mysql: 'mysql',
  mariadb: 'mariadb',
  mssql: 'mssql',
  sqlite: 'sqlite',
  cockroachdb: null,
  mongodb: null
}

const db = integrationDbName()
const seqDialect = DIALECT[db] ?? null
const url = process.env.DATABASE_URL ?? ''
const runnable = !!url && seqDialect !== null

type SeqDialect = 'postgres' | 'mysql' | 'mariadb' | 'mssql' | 'sqlite'

function connectSequelizeForDb(dbName: string, dialect: SeqDialect, dbUrl: string): Sequelize {
  if (dialect === 'sqlite') {
    return new Sequelize({
      dialect: 'sqlite',
      storage: dbUrl.replace(/^file:/, ''),
      logging: false
    })
  }
  if (dialect === 'mssql') {
    const cfg = parseMssqlUrl(dbUrl)
    return new Sequelize(cfg.database, cfg.user, cfg.password, {
      host: cfg.server,
      port: cfg.port,
      dialect: 'mssql',
      logging: false,
      dialectOptions: {
        options: { encrypt: cfg.encrypt, trustServerCertificate: cfg.trustServerCertificate }
      }
    })
  }
  // postgres, mysql, mariadb — pass URL directly; normalise scheme for Sequelize's URL parser.
  const normalised =
    dbName === 'mariadb'
      ? dbUrl.replace(/^mysql:/, 'mariadb:')
      : dbUrl.replace(/^postgresql:/, 'postgres:')
  return new Sequelize(normalised, { dialect, logging: false })
}

function parseMssqlUrl(raw: string) {
  const [hostPart = '', ...kvParts] = raw.replace(/^sqlserver:\/\//, '').split(';')
  const [server = 'localhost', portStr] = hostPart.split(':')
  const params = new Map<string, string>()
  for (const part of kvParts) {
    const eq = part.indexOf('=')
    if (eq > 0) params.set(part.slice(0, eq).toLowerCase(), part.slice(eq + 1))
  }
  return {
    server,
    port: portStr ? Number(portStr) : 1433,
    database: params.get('database') ?? 'halifax_test',
    user: params.get('user') ?? 'sa',
    password: params.get('password') ?? '',
    encrypt: params.get('encrypt') !== 'false',
    trustServerCertificate: params.get('trustservercertificate') === 'true'
  }
}

// Outer describe.skipIf prevents any hooks from running when the dialect is unsupported.
describe.skipIf(!runnable)(`SequelizeAdapter (${db}) — matrix`, () => {
  let sequelize: Sequelize
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PostModel: any

  beforeAll(async () => {
    sequelize = connectSequelizeForDb(db, seqDialect as SeqDialect, url)
    PostModel = definePostModel(sequelize)
    // force: true drops and recreates so tests always start from a clean table.
    await sequelize.sync({ force: true })
  })

  afterAll(async () => {
    await PostModel?.drop?.()
    await sequelize?.close()
  })

  // runRepositoryContract is synchronous (registers vitest blocks during collection).
  // Its createSetup factory runs inside the inner beforeAll, which fires AFTER the outer
  // beforeAll above — so PostModel is defined by the time the factory is called.
  runRepositoryContract(`SequelizeAdapter (${db})`, async () => ({
    repo: new SequelizeAdapter<Post, Omit<Post, 'id'>, Partial<Post>>(PostModel as SeqModel),
    cleanup: async () => {
      await PostModel.destroy({ where: {} })
    }
  }))
})
