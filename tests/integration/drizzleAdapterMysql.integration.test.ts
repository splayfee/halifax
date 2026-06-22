/**
 * DrizzleAdapter integration tests for MySQL / MariaDB.
 *
 * Validates the `dialect: 'mysql'` code paths in DrizzleAdapter that use two-round-trip
 * writes instead of `.returning()` (which MySQL does not support). Runs only when
 * HALIFAX_DB ∈ {mysql, mariadb} and DATABASE_URL is set.
 *
 * Uses table `posts_drz` (not `posts`) to avoid conflicting with the Prisma-managed
 * `posts` table created by globalSetup's `prisma db push`.
 */

import mysql from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import { mysqlTable, int, varchar, boolean, text } from 'drizzle-orm/mysql-core'
import { afterAll, beforeAll, describe } from 'vitest'
import { DrizzleAdapter } from '@/adapters/orm/drizzle/DrizzleAdapter.js'
import type { AnyDrizzleDB } from '@/adapters/orm/drizzle/DrizzleAdapter.js'
import { runRepositoryContract } from '../helpers/repositoryContract.js'
import { integrationDbName } from '../helpers/integrationDb.js'

const MYSQL_RUNNABLE: Record<string, boolean> = {
  mysql: true,
  mariadb: true
}

const db = integrationDbName()
const url = process.env.DATABASE_URL ?? ''
const runnable = !!url && !!MYSQL_RUNNABLE[db]

const postsTable = mysqlTable('posts_drz', {
  id: int('id').primaryKey().autoincrement(),
  title: varchar('title', { length: 255 }).notNull().default(''),
  content: text('content'),
  published: boolean('published').notNull().default(false),
  tenantId: varchar('tenant_id', { length: 255 })
})

type Post = {
  id: number
  title: string
  content: string | null
  published: boolean
  tenantId: string | null
}

describe.skipIf(!runnable)(`DrizzleAdapter (${db}) — MySQL dialect`, () => {
  let connection: mysql.Connection
  let drizzleDb: AnyDrizzleDB

  beforeAll(async () => {
    connection = await mysql.createConnection(url)
    // Cast required: mysql2 drizzle db types don't share a common structural interface
    // with the postgres variant. AnyDrizzleDB bridges the gap structurally at runtime.
    drizzleDb = drizzle(connection) as unknown as AnyDrizzleDB
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS posts_drz (
        id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title      VARCHAR(255) NOT NULL DEFAULT '',
        content    TEXT,
        published  TINYINT(1)   NOT NULL DEFAULT 0,
        tenant_id  VARCHAR(255)
      )
    `)
  })

  afterAll(async () => {
    await connection.execute('DROP TABLE IF EXISTS posts_drz')
    await connection.end()
  })

  runRepositoryContract(`DrizzleAdapter MySQL (${db})`, async () => ({
    repo: new DrizzleAdapter<Post, Omit<Post, 'id'>, Partial<Post>>(drizzleDb, postsTable, {
      dialect: 'mysql'
    }),
    cleanup: async () => {
      await connection.execute('DELETE FROM posts_drz')
    }
  }))
})
