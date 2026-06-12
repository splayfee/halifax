import { defineConfig } from 'prisma/config'

// Prisma 7 no longer allows a `url` in the schema datasource — the CLI (generate / db push /
// migrate) reads the connection string from here for every engine, including MongoDB.
export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL
  }
})
