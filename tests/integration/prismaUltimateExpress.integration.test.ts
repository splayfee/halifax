/**
 * Full-stack integration tests: PrismaAdapter + Ultimate Express + PostgreSQL.
 *
 * Run with: pnpm test:integration
 * Requires DATABASE_URL in .env.test. All tests are skipped when DATABASE_URL is not set.
 */

import ue from 'ultimate-express'
import { createUltimateExpressCrudRouter } from '@/adapters/http/UltimateExpressAdapter.js'
import { getFreePort } from '../helpers/freePort.js'
import { runPrismaHttpContract } from '../helpers/prismaHttpContract.js'

runPrismaHttpContract('Ultimate Express', async (resources, authStrategy) => {
  const app = ue()
  app.use(ue.json())
  app.use('/api', createUltimateExpressCrudRouter(resources, { authStrategy }))

  const port = await getFreePort()
  await new Promise<void>((resolve) => {
    app.listen(port, () => resolve())
  })

  return {
    target: `http://127.0.0.1:${port}`,
    close: () => {
      // `close` exists at runtime but is missing from ultimate-express's type surface.
      ;(app as unknown as { close: () => void }).close()
    }
  }
})
