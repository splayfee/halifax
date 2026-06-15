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

/**
 * The runtime shape of a primary key for the selected engine. Every SQL engine uses an
 * integer autoincrement/sequence/identity key; MongoDB keys documents by a 24-char hex
 * ObjectId string. The shared suite is written once and adapts its key assertions to this
 * so the *same* tests run honestly against both key kinds.
 */
export type IdKind = 'int' | 'objectid'

/** The primary-key kind for the selected database. */
export function idKind(db: IntegrationDbName = integrationDbName()): IdKind {
  return db === 'mongodb' ? 'objectid' : 'int'
}

/** The `typeof` an id value for the selected engine — feed to `expect(...).toBeTypeOf(...)`. */
export function idTypeName(db: IntegrationDbName = integrationDbName()): 'number' | 'string' {
  return idKind(db) === 'objectid' ? 'string' : 'number'
}

/**
 * A well-formed primary key that is guaranteed not to exist — for 404 / missing-row probes
 * and for upsert-creates that must target an absent key. An all-`f` ObjectId for MongoDB
 * (valid format, astronomically unlikely to collide), or a high integer for SQL engines.
 * @param db - The target database (defaults to the current selection).
 */
export function missingId(db: IntegrationDbName = integrationDbName()): string | number {
  return idKind(db) === 'objectid' ? 'ffffffffffffffffffffffff' : 999_999
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

  const { PrismaClient } = (await import('@prisma/client')) as unknown as { PrismaClient: new (opts: Record<string, unknown>) => { $connect(): Promise<void>; $disconnect(): Promise<void>; [key: string]: unknown } }

  let prisma: { $connect(): Promise<void>; $disconnect(): Promise<void>; [key: string]: unknown }

  // Loads a driver-adapter package by name via a non-literal specifier, so adapters that
  // are only installed in a given CI matrix leg don't need to resolve at build time.

  const loadDriver = (pkg: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ pkg) as Promise<Record<string, unknown>>

  switch (db) {
    case 'sqlite': {
      const { PrismaBetterSqlite3 } = (await import('@prisma/adapter-better-sqlite3')) as unknown as { PrismaBetterSqlite3: new (opts: Record<string, unknown>) => unknown }
      // better-sqlite3 wants a filesystem path; Prisma's URL form is `file:<path>`.
      prisma = new PrismaClient({
        adapter: new PrismaBetterSqlite3({ url: url.replace(/^file:/, '') })
      })
      break
    }
    case 'mysql':
    case 'mariadb': {
      const { PrismaMariaDb } = await loadDriver('@prisma/adapter-mariadb')
      prisma = new PrismaClient({ adapter: new (PrismaMariaDb as new (u: string) => unknown)(url) })
      break
    }
    case 'mssql': {
      const { PrismaMssql } = await loadDriver('@prisma/adapter-mssql')
      // node-mssql doesn't understand Prisma's JDBC-style `sqlserver://host:port;k=v;…` URL,
      // so translate it into the `mssql` config object the adapter expects.
      prisma = new PrismaClient({ adapter: new (PrismaMssql as new (c: Record<string, unknown>) => unknown)(mssqlConfigFromUrl(url)) })
      break
    }
    case 'mongodb': {
      // Prisma 7 dropped MongoDB support (no driver adapter exists, and the client constructor
      // requires `adapter` or `accelerateUrl`); it is "coming soon in v7" per Prisma's upgrade
      // guide. The schema, the ObjectId-aware suite, and the compose service are all kept ready
      // so this leg lights up the moment Prisma 7 ships MongoDB — until then, fail loudly.
      throw new Error(
        'MongoDB integration tests are not runnable on Prisma 7 yet — Prisma ORM v7 does not ' +
          'support MongoDB (see https://pris.ly/d/prisma7-mongodb). The harness is forward-ready.'
      )
    }
    case 'postgres':
    case 'cockroachdb':
    default: {
      const { PrismaPg } = (await import('@prisma/adapter-pg')) as { PrismaPg: new (url: string) => unknown }
      prisma = new PrismaClient({ adapter: new PrismaPg(url) })
      break
    }
  }

  await prisma.$connect()
  return prisma
}

/**
 * Translates a Prisma SQL Server connection URL into a node-mssql config object.
 * Prisma uses a JDBC-style URL — `sqlserver://host:port;database=…;user=…;password=…;…` —
 * which the `mssql` driver (and therefore `@prisma/adapter-mssql`) cannot parse directly.
 * @param url - The `sqlserver://` DATABASE_URL.
 * @returns A node-mssql `config` object suitable for `new PrismaMssql(config)`.
 */
function mssqlConfigFromUrl(url: string): Record<string, unknown> {
  const [hostPart = '', ...kvParts] = url.replace(/^sqlserver:\/\//, '').split(';')
  const [server, port] = hostPart.split(':')
  const params = new Map<string, string>()
  for (const part of kvParts) {
    if (!part) continue
    const eq = part.indexOf('=')
    params.set(part.slice(0, eq).toLowerCase(), part.slice(eq + 1))
  }
  return {
    server,
    port: port ? Number(port) : 1433,
    database: params.get('database'),
    user: params.get('user'),
    password: params.get('password'),
    options: {
      encrypt: params.get('encrypt') !== 'false',
      trustServerCertificate: params.get('trustservercertificate') === 'true'
    }
  }
}
