/**
 * Unit tests for UltimateExpressAdapter class methods.
 *
 * The full runAdapterContract suite in ultimateExpressAdapter.test.ts requires
 * uWebSockets native binaries, which are not available on all platforms. These
 * tests mock `ultimate-express` so the adapter's request/response adaptation
 * and route registration logic can be verified independently of the native layer.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

// vi.mock is hoisted above imports — must be declared before the module is imported.
vi.mock('ultimate-express', () => {
  function Router() {
    return {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      all: vi.fn()
    }
  }
  return {
    default: Object.assign(
      vi.fn(() => ({})),
      { Router }
    )
  }
})

import { UltimateExpressHttpServer } from '@/adapters/http/UltimateExpressAdapter.js'
import type { UltimateExpressAppLike } from '@/adapters/http/UltimateExpressAdapter.js'
import type { HttpRequest, HttpResponse } from '@/core/types.js'

// ─── Mock UE request / response ───────────────────────────────────────────────

function makeUERequest(overrides = {}) {
  return {
    method: 'GET',
    params: { id: '42' },
    query: { limit: '10' },
    body: { title: 'hello' },
    headers: { 'content-type': 'application/json' },
    ...overrides
  }
}

function makeUEResponse() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    send: vi.fn(),
    setHeader: vi.fn()
  }
  return res
}

// ─── Mock UE app ─────────────────────────────────────────────────────────────

function makeApp(): UltimateExpressAppLike & Record<string, ReturnType<typeof vi.fn>> {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    all: vi.fn()
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('UltimateExpressHttpServer.registerRoute', () => {
  let app: ReturnType<typeof makeApp>
  let server: UltimateExpressHttpServer

  beforeEach(() => {
    app = makeApp()
    server = new UltimateExpressHttpServer(app)
  })

  it('registers GET route on the app', () => {
    server.registerRoute('GET', '/things', vi.fn())
    expect(app.get).toHaveBeenCalledWith('/things', expect.any(Function))
  })

  it('registers POST route on the app', () => {
    server.registerRoute('POST', '/things', vi.fn())
    expect(app.post).toHaveBeenCalledWith('/things', expect.any(Function))
  })

  it('registers PUT route on the app', () => {
    server.registerRoute('PUT', '/things/:id', vi.fn())
    expect(app.put).toHaveBeenCalledWith('/things/:id', expect.any(Function))
  })

  it('registers PATCH route on the app', () => {
    server.registerRoute('PATCH', '/things/:id', vi.fn())
    expect(app.patch).toHaveBeenCalledWith('/things/:id', expect.any(Function))
  })

  it('registers DELETE route on the app', () => {
    server.registerRoute('DELETE', '/things/:id', vi.fn())
    expect(app.delete).toHaveBeenCalledWith('/things/:id', expect.any(Function))
  })

  it('uses app.all for wildcard method *', () => {
    server.registerRoute('*', '/things', vi.fn())
    expect(app.all).toHaveBeenCalledWith('/things', expect.any(Function))
  })

  it('adapts the UE request into a Halifax HttpRequest', async () => {
    let capturedReq: HttpRequest | null = null
    server.registerRoute('GET', '/things', async (req) => {
      capturedReq = req
    })

    const [, cb] = (app.get as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, (req: unknown, res: unknown) => Promise<void>]
    const ueReq = makeUERequest()
    const ueRes = makeUEResponse()
    await cb(ueReq, ueRes)

    expect(capturedReq!.method).toBe('GET')
    expect(capturedReq!.params).toEqual({ id: '42' })
    expect(capturedReq!.query).toEqual({ limit: '10' })
    expect(capturedReq!.body).toEqual({ title: 'hello' })
    expect(capturedReq!.headers).toMatchObject({ 'content-type': 'application/json' })
    expect(capturedReq!.raw).toBe(ueReq)
  })

  it('adapts the UE response into a Halifax HttpResponse', async () => {
    let capturedRes: HttpResponse | null = null
    server.registerRoute('GET', '/things', async (_req, res) => {
      capturedRes = res
    })

    const [, cb] = (app.get as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, (req: unknown, res: unknown) => Promise<void>]
    const ueRes = makeUEResponse()
    await cb(makeUERequest(), ueRes)

    capturedRes!.status(404)
    expect(ueRes.status).toHaveBeenCalledWith(404)

    capturedRes!.json({ error: true })
    expect(ueRes.json).toHaveBeenCalledWith({ error: true })

    capturedRes!.send!('ok')
    expect(ueRes.send).toHaveBeenCalledWith('ok')

    capturedRes!.setHeader!('X-Foo', 'bar')
    expect(ueRes.setHeader).toHaveBeenCalledWith('X-Foo', 'bar')

    expect(capturedRes!.raw).toBe(ueRes)
  })

  it('status() returns the response for chaining', async () => {
    let capturedRes: HttpResponse | null = null
    server.registerRoute('GET', '/things', async (_req, res) => {
      capturedRes = res
    })

    const [, cb] = (app.get as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, (req: unknown, res: unknown) => Promise<void>]
    await cb(makeUERequest(), makeUEResponse())

    expect(capturedRes!.status(200)).toBe(capturedRes)
  })
})

describe('UltimateExpressHttpServer.start', () => {
  it('calls app.listen and resolves when listen is present', async () => {
    const listen = vi.fn<(port: number, host: string | undefined, cb: () => void) => void>(
      (_port, _host, cb) => cb()
    )
    const app = { ...makeApp(), listen }
    const server = new UltimateExpressHttpServer(app)
    await expect(server.start(3000, 'localhost')).resolves.toBeUndefined()
    expect(listen).toHaveBeenCalledWith(3000, 'localhost', expect.any(Function))
  })

  it('resolves immediately when app has no listen (router mode)', async () => {
    const app = makeApp() // no listen property
    const server = new UltimateExpressHttpServer(app)
    await expect(server.start(3000)).resolves.toBeUndefined()
  })
})
