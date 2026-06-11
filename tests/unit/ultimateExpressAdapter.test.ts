import ue from 'ultimate-express'
import { createUltimateExpressCrudRouter } from '@/adapters/http/UltimateExpressAdapter.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import { getFreePort } from '../helpers/freePort.js'
import {
  CONTRACT_API_KEY,
  CONTRACT_PREFIX,
  contractResources,
  runAdapterContract
} from '../helpers/adapterContract.js'

// Ultimate Express runs on uWebSockets, so the app is not a Node http.Server; supertest
// must talk to a really-listening server over a URL (hence getFreePort + listen).
runAdapterContract('Ultimate Express', async () => {
  const app = ue()
  app.use(ue.json())
  app.use(
    CONTRACT_PREFIX,
    createUltimateExpressCrudRouter(contractResources(), {
      authStrategy: new ApiKeyAuthStrategy(CONTRACT_API_KEY)
    })
  )

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
