/**
 * Database: SQL Server  (Prisma `provider = "sqlserver"`, driver adapter `@prisma/adapter-mssql`)
 *
 * The `@prisma/adapter-mssql` driver wraps node-mssql, which takes a config object (it does NOT
 * parse Prisma's JDBC-style `sqlserver://host;key=value` URL). Build the config from your own
 * env vars, as below.
 *
 *   MSSQL_HOST=localhost MSSQL_DB=mydb MSSQL_USER=sa MSSQL_PASSWORD='Str0ng!Passw0rd' \
 *     pnpm tsx examples/db-mssql.ts
 */

import express from 'express'
import { PrismaClient } from '@prisma/client'
import { PrismaMssql } from '@prisma/adapter-mssql'
import {
  ApiKeyAuthStrategy,
  PrismaAdapter,
  createExpressCrudRouter,
  type ResourceDefinition
} from '../src/index.js'

const adapter = new PrismaMssql({
  server: process.env.MSSQL_HOST ?? 'localhost',
  port: Number(process.env.MSSQL_PORT ?? 1433),
  database: process.env.MSSQL_DB ?? 'mydb',
  user: process.env.MSSQL_USER ?? 'sa',
  password: process.env.MSSQL_PASSWORD!,
  options: { encrypt: true, trustServerCertificate: true }
})
const prisma = new PrismaClient({ adapter })

const posts: ResourceDefinition = {
  routePrefix: 'posts',
  repository: new PrismaAdapter({ delegate: prisma.post }),
  fields: [{ name: 'id' }, { name: 'title' }, { name: 'content' }, { name: 'published' }]
}

const app = express()
app.use(express.json())
app.use(
  '/api/v1',
  createExpressCrudRouter([posts], {
    authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY ?? 'dev-secret')
  })
)
app.listen(Number(process.env.PORT ?? 3000))
