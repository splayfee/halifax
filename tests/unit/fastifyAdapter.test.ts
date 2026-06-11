import Fastify from 'fastify'
import { createFastifyCrudPlugin } from '@/adapters/http/FastifyAdapter.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import {
  CONTRACT_API_KEY,
  CONTRACT_PREFIX,
  contractResources,
  runAdapterContract
} from '../helpers/adapterContract.js'

// Fastify's `app.server` is a Node http.Server, so supertest can drive it in-process
// after `ready()` — no real port binding required.
runAdapterContract('Fastify', async () => {
  const app = Fastify()
  await app.register(
    createFastifyCrudPlugin(contractResources(), {
      authStrategy: new ApiKeyAuthStrategy(CONTRACT_API_KEY)
    }),
    { prefix: CONTRACT_PREFIX }
  )
  await app.ready()

  return {
    target: app.server,
    close: () => app.close()
  }
})
