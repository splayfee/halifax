import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Databases the integration suite can run against. The same suite runs unchanged against
 * each — the whole point of compiling the query AST to portable Prisma Client calls.
 */
export type IntegrationDbName =
  | 'postgres'
  | 'cockroachdb'
  | 'mysql'
  | 'mariadb'
  | 'mssql'
  | 'sqlite'
  | 'mongodb'

/** The database selected for this run via `HALIFAX_DB` (defaults to `postgres`). */
export function integrationDbName(): IntegrationDbName {
  return (process.env.HALIFAX_DB ?? 'postgres') as IntegrationDbName
}

const prismaDir = path.join(fileURLToPath(import.meta.url), '../../integration/prisma')

/**
 * Absolute path to the Prisma schema for the selected database. Postgres uses the default
 * `schema.prisma`; every other engine has a `schema.<db>.prisma` sibling.
 * @param db - The target database (defaults to the current selection).
 * @returns Absolute path to the schema file.
 */
export function schemaPathFor(db: IntegrationDbName = integrationDbName()): string {
  // Postgres uses the default schema; MariaDB rides the MySQL schema (same Prisma provider).
  const file =
    db === 'postgres'
      ? 'schema.prisma'
      : db === 'mariadb'
        ? 'schema.mysql.prisma'
        : `schema.${db}.prisma`
  return path.join(prismaDir, file)
}

/**
 * Builds and connects a Prisma client for the selected database, wiring the appropriate
 * driver adapter. Driver-adapter packages are imported dynamically so only the selected
 * engine's adapter needs to be installed for a given run.
 *
 * @returns A connected Prisma client (typed loosely; the generated client provides real types).
 */
export async function connectIntegrationDb(): Promise<{
  $connect(): Promise<void>
  $disconnect(): Promise<void>
  [key: string]: unknown
}> {
  const db = integrationDbName()
  const url = process.env.DATABASE_URL!

  const { PrismaClient } = (await import('@prisma/client')) as any

  let prisma: any

  // Loads a driver-adapter package by name via a non-literal specifier, so adapters that
  // are only installed in a given CI matrix leg don't need to resolve at build time.

  const loadDriver = (pkg: string): Promise<any> => import(/* @vite-ignore */ pkg)

  switch (db) {
    case 'sqlite': {
      const { PrismaBetterSqlite3 } = (await import('@prisma/adapter-better-sqlite3')) as any
      // better-sqlite3 wants a filesystem path; Prisma's URL form is `file:<path>`.
      prisma = new PrismaClient({
        adapter: new PrismaBetterSqlite3({ url: url.replace(/^file:/, '') })
      })
      break
    }
    case 'mysql':
    case 'mariadb': {
      const { PrismaMariaDb } = await loadDriver('@prisma/adapter-mariadb')
      prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) })
      break
    }
    case 'mssql': {
      const { PrismaMssql } = await loadDriver('@prisma/adapter-mssql')
      prisma = new PrismaClient({ adapter: new PrismaMssql(url) })
      break
    }
    case 'mongodb': {
      // MongoDB uses Prisma's built-in connector (no driver adapter); the URL comes from env.
      prisma = new PrismaClient()
      break
    }
    case 'postgres':
    case 'cockroachdb':
    default: {
      const { PrismaPg } = (await import('@prisma/adapter-pg')) as any
      prisma = new PrismaClient({ adapter: new PrismaPg(url) })
      break
    }
  }

  await prisma.$connect()
  return prisma
}
