/**
 * Full-stack integration tests: PrismaAdapter + HyperExpress + PostgreSQL.
 *
 * Run with: pnpm test:integration
 * Requires DATABASE_URL in .env.test. All tests are skipped when DATABASE_URL is not set.
 */

import HyperExpress from 'hyper-express'
import { createHyperExpressCrudRouter } from '@/adapters/http/HyperExpressAdapter.js'
import { getFreePort } from '../helpers/freePort.js'
import { runPrismaHttpContract } from '../helpers/prismaHttpContract.js'

runPrismaHttpContract('HyperExpress', async (resources, authStrategy) => {
  const server = new HyperExpress.Server()
  server.use('/api', createHyperExpressCrudRouter(resources, { authStrategy }))

  const port = await getFreePort()
  await server.listen(port)

  return {
    target: `http://127.0.0.1:${port}`,
    close: () => {
      server.close()
    }
  }
})
