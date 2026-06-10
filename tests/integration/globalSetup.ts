import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const schemaPath = path.join(fileURLToPath(import.meta.url), '../prisma/schema.prisma')

export async function setup(): Promise<void> {
  // prisma generate does not need a DB connection — always run it so the
  // generated client exists before test files are imported.
  execSync(`pnpm exec prisma generate --schema=${schemaPath}`, { stdio: 'inherit' })

  if (!process.env.DATABASE_URL) {
    console.warn('[globalSetup] DATABASE_URL not set — integration tests will be skipped.')
    return
  }

  // Push the schema to the test database (creates / updates tables, no migration history).
  execSync(`pnpm exec prisma db push --schema=${schemaPath} --accept-data-loss`, {
    stdio: 'inherit'
  })
}
