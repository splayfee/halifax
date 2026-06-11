/**
 * Full-stack integration tests: PrismaAdapter + Fastify + PostgreSQL.
 *
 * Run with: pnpm test:integration
 * Requires DATABASE_URL in .env.test. All tests are skipped when DATABASE_URL is not set.
 */

import Fastify from 'fastify'
import { createFastifyCrudPlugin } from '@/adapters/http/FastifyAdapter.js'
import { runPrismaHttpContract } from '../helpers/prismaHttpContract.js'

runPrismaHttpContract('Fastify', async (resources, authStrategy) => {
  const app = Fastify()
  await app.register(createFastifyCrudPlugin(resources, { authStrategy }), { prefix: '/api' })
  await app.ready()

  return {
    target: app.server,
    close: () => app.close()
  }
})
