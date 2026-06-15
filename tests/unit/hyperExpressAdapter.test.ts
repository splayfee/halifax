import { vi, describe, it, expect } from 'vitest'
import HyperExpress from 'hyper-express'
import {
  createHyperExpressCrudRouter,
  HyperExpressHttpServer
} from '@/adapters/http/HyperExpressAdapter.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import { getFreePort } from '../helpers/freePort.js'
import {
  CONTRACT_API_KEY,
  CONTRACT_PREFIX,
  contractResources,
  runAdapterContract
} from '../helpers/adapterContract.js'
import type { HyperExpressAppLike } from '@/adapters/http/HyperExpressAdapter.js'

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

// ─── HyperExpressHttpServer unit tests ────────────────────────────────────────

/** Build a mock HyperExpress app (Server-like: has listen). */
function makeApp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    any: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined)
  }
}

/** Build a mock HyperExpress router (no listen method). */
function makeRouter() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    any: vi.fn()
    // deliberately no listen
  }
}

/** Build a mock HyperExpress request. */
function makeRequest(
  overrides: Partial<{
    method: string
    path_parameters: Record<string, string>
    query_parameters: Record<string, string>
    headers: Record<string, string | string[] | undefined>
    json: () => Promise<unknown>
  }> = {}
) {
  return {
    method: 'POST',
    path_parameters: {},
    query_parameters: {},
    headers: { 'content-type': 'application/json' },
    json: vi.fn().mockResolvedValue({ key: 'value' }),
    ...overrides
  }
}

/** Build a mock HyperExpress response. */
function makeResponse() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    send: vi.fn(),
    header: vi.fn()
  }
  return res
}

describe('HyperExpressHttpServer — adaptRequest JSON parse error', () => {
  it('sets body to undefined when req.json() throws', async () => {
    const app = makeApp()
    const server = new HyperExpressHttpServer(app as HyperExpressAppLike)

    let capturedBody: unknown = 'NOT_SET'
    server.registerRoute('POST', '/items', async (req) => {
      capturedBody = req.body
    })

    // Extract the registered callback from app.post
    const [, cb] = app.post.mock.calls[0]! as [
      string,
      (req: ReturnType<typeof makeRequest>, res: ReturnType<typeof makeResponse>) => Promise<void>
    ]

    const req = makeRequest({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      json: vi.fn().mockRejectedValue(new Error('parse error'))
    })
    const res = makeResponse()
    await cb(req, res)

    expect(capturedBody).toBeUndefined()
  })
})

describe('HyperExpressHttpServer — start', () => {
  it('calls listen with port and host when host is provided', async () => {
    const app = makeApp()
    const server = new HyperExpressHttpServer(app as HyperExpressAppLike)
    const listenSpy = vi.spyOn(app, 'listen').mockResolvedValue(undefined)
    await server.start(3001, '0.0.0.0')
    expect(listenSpy).toHaveBeenCalledWith(3001, '0.0.0.0')
  })

  it('start() is a no-op when the app has no listen method', async () => {
    const router = makeRouter()
    const server = new HyperExpressHttpServer(router as HyperExpressAppLike)
    await expect(server.start(3000)).resolves.toBeUndefined()
  })
})
