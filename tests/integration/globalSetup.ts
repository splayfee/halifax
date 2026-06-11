import { execSync } from 'node:child_process'
import { schemaPathFor, integrationDbName } from '../helpers/integrationDb.js'

export async function setup(): Promise<void> {
  const db = integrationDbName()
  const schemaPath = schemaPathFor(db)

  // prisma generate does not need a DB connection — always run it so the generated client
  // exists (for the selected database) before any test file is imported.
  execSync(`pnpm exec prisma generate --schema=${schemaPath}`, { stdio: 'inherit' })

  if (!process.env.DATABASE_URL) {
    console.warn(`[globalSetup] DATABASE_URL not set — integration tests (${db}) will be skipped.`)
    return
  }

  // Push the schema to the test database (creates / updates tables, no migration history).
  // `db push` works for every supported provider, including MongoDB.
  execSync(`pnpm exec prisma db push --schema=${schemaPath} --accept-data-loss`, {
    stdio: 'inherit'
  })
}
