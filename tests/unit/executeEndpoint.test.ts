import { describe, it, expect } from 'vitest'
import { registerCrudApi } from '@/core/crudRouter.js'
import type { SqlExecutor } from '@/core/execute.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import type { ExecuteValue } from '@edium/halifax-types'
import type { HttpMethod, HttpRequest, HttpResponse, HttpServer } from '@/core/types.js'

// ─── Minimal test harness (mirrors tests/unit/customEndpoint.test.ts) ─────────

function makeServer() {
  const routes = new Map<string, (req: HttpRequest, res: HttpResponse) => Promise<void> | void>()
  const server: HttpServer = {
    registerRoute(method, path, handler) {
      routes.set(`${method}:${path}`, handler)
    },
    async start() {}
  }
  return { server, routes }
}

function makeReq(method = 'POST', overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method,
    params: {},
    query: {},
    body: {},
    headers: { 'content-type': 'application/json' },
    raw: {},
    ...overrides
  }
}

function makeRes() {
  const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} }
  const res: HttpResponse = {
    raw: {},
    status(code) {
      sent.status = code
      return this
    },
    json(payload) {
      sent.body = payload
    },
    send(payload) {
      sent.body = payload
    },
    setHeader(name, value) {
      sent.headers[name] = value
    }
  }
  return { res, sent }
}

function invoke(
  routes: Map<string, (req: HttpRequest, res: HttpResponse) => Promise<void> | void>,
  method: HttpMethod,
  path: string,
  req: HttpRequest,
  res: HttpResponse
) {
  const handler = routes.get(`${method}:${path}`)
  if (!handler) throw new Error(`No route registered for ${method}:${path}`)
  return Promise.resolve(handler(req, res))
}

function fakeExecutor(rows: unknown[] = []): SqlExecutor & { calls: Array<[string, ExecuteValue[]]> } {
  const calls: Array<[string, ExecuteValue[]]> = []
  return {
    calls,
    async call(name, params) {
      calls.push([name, params])
      return rows
    }
  }
}

// ─── Registration: one route per procedure, kebab-cased, off by default ───────

describe('execute — per-procedure route registration', () => {
  it('registers NO routes when the execute option is absent (off by default)', () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [], {})
    expect([...routes.keys()].some((k) => k.includes('/execute'))).toBe(false)
  })

  it('registers one POST route per procedure at a kebab-cased path', () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [], {
      execute: { executor: fakeExecutor(), procedures: [{ name: 'get_report' }, { name: 'recalcBalances' }] }
    })
    expect(routes.has('POST:/execute/get-report')).toBe(true)
    expect(routes.has('POST:/execute/recalc-balances')).toBe(true)
  })

  it('honours a custom basePath and a per-procedure path override', () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [], {
      execute: {
        executor: fakeExecutor(),
        basePath: '/rpc',
        procedures: [
          { name: 'get_report' }, // → /rpc/get-report
          { name: 'special', path: 'custom-seg' }, // segment under basePath
          { name: 'other', path: '/reports/full' } // absolute path
        ]
      }
    })
    expect(routes.has('POST:/rpc/get-report')).toBe(true)
    expect(routes.has('POST:/rpc/custom-seg')).toBe(true)
    expect(routes.has('POST:/reports/full')).toBe(true)
  })

  it('an unregistered procedure simply has no route (→ framework 404, never a 405)', () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [], { execute: { executor: fakeExecutor(), procedures: [{ name: 'allowed' }] } })
    expect(routes.has('POST:/execute/not-registered')).toBe(false)
  })
})

// ─── Invocation + named/typed parameters ──────────────────────────────────────

describe('execute — invocation', () => {
  it('validates named params and binds them positionally in declared order', async () => {
    const executor = fakeExecutor([{ id: 1 }])
    const { server, routes } = makeServer()
    registerCrudApi(server, [], {
      execute: {
        executor,
        procedures: [
          {
            name: 'get_report',
            params: [
              { name: 'year', type: 'number' },
              { name: 'quarter', type: 'string' },
              { name: 'tags', type: 'string[]', required: false }
            ]
          }
        ]
      }
    })

    // Named body, deliberately out of declaration order — must bind positionally as [year, quarter, tags].
    const req = makeReq('POST', { body: { quarter: 'Q2', year: 2026, tags: ['a', 'b'] } })
    const { res, sent } = makeRes()
    await invoke(routes, 'POST', '/execute/get-report', req, res)

    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ rows: [{ id: 1 }], rowCount: 1 })
    expect(executor.calls).toEqual([['get_report', [2026, 'Q2', ['a', 'b']]]])
  })

  it('returns an empty row set for a void routine', async () => {
    const executor = fakeExecutor([])
    const { server, routes } = makeServer()
    registerCrudApi(server, [], { execute: { executor, procedures: [{ name: 'recalc' }] } })

    const { res, sent } = makeRes()
    await invoke(routes, 'POST', '/execute/recalc', makeReq('POST', { body: {} }), res)
    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ rows: [], rowCount: 0 })
    expect(executor.calls).toEqual([['recalc', []]])
  })

  it('rejects a missing required parameter with 422 and never calls the executor', async () => {
    const executor = fakeExecutor()
    const { server, routes } = makeServer()
    registerCrudApi(server, [], {
      execute: { executor, procedures: [{ name: 'get_report', params: [{ name: 'year', type: 'number' }] }] }
    })

    const { res, sent } = makeRes()
    await invoke(routes, 'POST', '/execute/get-report', makeReq('POST', { body: {} }), res)
    expect(sent.status).toBe(422)
    expect(executor.calls).toEqual([])
  })

  it('rejects a wrong-typed parameter with 422', async () => {
    const executor = fakeExecutor()
    const { server, routes } = makeServer()
    registerCrudApi(server, [], {
      execute: { executor, procedures: [{ name: 'get_report', params: [{ name: 'year', type: 'number' }] }] }
    })

    const { res, sent } = makeRes()
    await invoke(routes, 'POST', '/execute/get-report', makeReq('POST', { body: { year: 'nope' } }), res)
    expect(sent.status).toBe(422)
    expect(executor.calls).toEqual([])
  })

  it('rejects an unknown parameter with 422', async () => {
    const executor = fakeExecutor()
    const { server, routes } = makeServer()
    registerCrudApi(server, [], {
      execute: { executor, procedures: [{ name: 'get_report', params: [{ name: 'year', type: 'number' }] }] }
    })

    const { res, sent } = makeRes()
    await invoke(
      routes,
      'POST',
      '/execute/get-report',
      makeReq('POST', { body: { year: 2026, bogus: 1 } }),
      res
    )
    expect(sent.status).toBe(422)
    expect(executor.calls).toEqual([])
  })

  it('enforces per-procedure roles (403)', async () => {
    const executor = fakeExecutor([{ ok: true }])
    const { server, routes } = makeServer()
    registerCrudApi(server, [], {
      authStrategy: new ApiKeyAuthStrategy('secret', 'x-api-key', ['user']),
      execute: { executor, procedures: [{ name: 'danger', roles: ['admin'] }] }
    })

    const req = makeReq('POST', {
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: {}
    })
    const { res, sent } = makeRes()
    await invoke(routes, 'POST', '/execute/danger', req, res)
    expect(sent.status).toBe(403)
    expect(executor.calls).toEqual([])
  })
})
