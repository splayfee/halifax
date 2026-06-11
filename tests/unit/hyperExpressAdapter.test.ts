import HyperExpress from 'hyper-express'
import { createHyperExpressCrudRouter } from '@/adapters/http/HyperExpressAdapter.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import { getFreePort } from '../helpers/freePort.js'
import {
  CONTRACT_API_KEY,
  CONTRACT_PREFIX,
  contractResources,
  runAdapterContract
} from '../helpers/adapterContract.js'

// HyperExpress runs on uWebSockets, so the app is not a Node http.Server; supertest must
// talk to a really-listening server over a URL (hence getFreePort + listen).
runAdapterContract('HyperExpress', async () => {
  const server = new HyperExpress.Server()
  server.use(
    CONTRACT_PREFIX,
    createHyperExpressCrudRouter(contractResources(), {
      authStrategy: new ApiKeyAuthStrategy(CONTRACT_API_KEY)
    })
  )

  const port = await getFreePort()
  await server.listen(port)

  return {
    target: `http://127.0.0.1:${port}`,
    close: () => {
      server.close()
    }
  }
})
