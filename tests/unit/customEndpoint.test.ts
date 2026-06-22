import { describe, it, expect, vi } from 'vitest'
import { registerCrudApi, HalifaxApi } from '@/core/crudRouter.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import { ServerError } from '@/errors/ServerError.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'
import type { HttpMethod, HttpRequest, HttpResponse, HttpServer, Repository } from '@/core/types.js'
import type { OpenApiSpec } from '@/openapi/types.js'

// ─── Minimal test harness ─────────────────────────────────────────────────────

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

function makeRepo(): Repository {
  return {
    async getOne() {
      return { id: 1, name: 'x' }
    },
    async getMany() {
      return { count: 0, results: [] }
    },
    async createOne(d) {
      return d as never
    },
    async createMany() {
      return []
    },
    async updateOne() {
      return null
    },
    async deleteOne() {
      return false
    }
  }
}

function makeReq(method = 'GET', overrides: Partial<HttpRequest> = {}): HttpRequest {
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
  const sent: { status?: number; body?: unknown; headers: Record<string, string> } = {
    headers: {}
  }
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

// ─── HalifaxApi.addCustomEndpoint — registration ──────────────────────────────

describe('HalifaxApi.addCustomEndpoint — registration', () => {
  it('registers the route on the underlying server', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {})

    let called = false
    api.addCustomEndpoint('GET', '/ping', [], async (_req, res) => {
      called = true
      await res.status(200).json({ ok: true })
    })

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/ping', makeReq('GET'), res)
    expect(called).toBe(true)
    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ ok: true })
  })

  it('returns this for chaining', () => {
    const { server } = makeServer()
    const api = registerCrudApi(server, [], {})
    const returned = api.addCustomEndpoint('GET', '/a', [], async () => {})
    expect(returned).toBe(api)
  })

  it('handler receives the resolved auth context', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {
      authStrategy: new ApiKeyAuthStrategy('secret')
    })

    let receivedAuth: unknown
    api.addCustomEndpoint('GET', '/me', [], async (_req, _res, ctx) => {
      receivedAuth = ctx.auth
    })

    const req = makeReq('GET', { headers: { 'x-api-key': 'secret' } })
    const { res } = makeRes()
    await invoke(routes, 'GET', '/me', req, res)
    expect(receivedAuth).toMatchObject({ isAuthenticated: true })
  })

  it('wrap applies content-type check on POST', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {})

    api.addCustomEndpoint('POST', '/items', [], async (_req, res) => {
      await res.status(201).json({ created: true })
    })

    const badReq = makeReq('POST', { headers: { 'content-type': 'text/plain' } })
    const { res, sent } = makeRes()
    await invoke(routes, 'POST', '/items', badReq, res)
    expect(sent.status).toBe(415)
  })

  it('wrap serialises thrown HttpErrors', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {})

    api.addCustomEndpoint('GET', '/boom', [], async () => {
      throw new AuthorizationError('nope')
    })

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/boom', makeReq('GET'), res)
    expect(sent.status).toBe(403)
    expect((sent.body as { errors: Array<{ code: string }> }).errors[0]!.code).toBe('FORBIDDEN')
  })

  it('wrap echoes X-Correlation-ID', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {})

    api.addCustomEndpoint('GET', '/echo', [], async (_req, res) => {
      await res.status(200).json({})
    })

    const req = makeReq('GET', { headers: { 'x-correlation-id': 'abc-123' } })
    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/echo', req, res)
    expect(sent.headers['X-Correlation-ID']).toBe('abc-123')
  })
})

// ─── HalifaxApi.addCustomEndpoint — duplicate detection ──────────────────────

describe('HalifaxApi.addCustomEndpoint — duplicate detection', () => {
  it('throws when the same custom endpoint is registered twice', () => {
    const { server } = makeServer()
    const api = registerCrudApi(server, [], {})
    api.addCustomEndpoint('GET', '/dup', [], async () => {})
    expect(() => api.addCustomEndpoint('GET', '/dup', [], async () => {})).toThrow(ServerError)
  })

  it('error message names the conflicting method and path', () => {
    const { server } = makeServer()
    const api = registerCrudApi(server, [], {})
    api.addCustomEndpoint('POST', '/conflict', [], async () => {})
    expect(() => api.addCustomEndpoint('POST', '/conflict', [], async () => {})).toThrow(
      /POST \/conflict/
    )
  })

  it('throws when the path conflicts with a generated CRUD route', () => {
    const { server } = makeServer()
    const api = registerCrudApi(
      server,
      [
        { routePrefix: 'items', fields: [{ name: 'id' }, { name: 'name' }], repository: makeRepo() }
      ],
      {}
    )
    // GET /items is registered by allowReadMany
    expect(() => api.addCustomEndpoint('GET', '/items', [], async () => {})).toThrow(ServerError)
  })

  it('throws when path conflicts with a CRUD item route', () => {
    const { server } = makeServer()
    const api = registerCrudApi(
      server,
      [
        { routePrefix: 'items', fields: [{ name: 'id' }, { name: 'name' }], repository: makeRepo() }
      ],
      {}
    )
    // PATCH /items/:id is registered by allowUpdateOne
    expect(() => api.addCustomEndpoint('PATCH', '/items/:id', [], async () => {})).toThrow(
      ServerError
    )
  })

  it('does not throw for same path with a different method', () => {
    const { server } = makeServer()
    const api = registerCrudApi(server, [], {})
    api.addCustomEndpoint('GET', '/shared', [], async () => {})
    expect(() => api.addCustomEndpoint('POST', '/shared', [], async () => {})).not.toThrow()
  })

  it('does not throw for different paths with the same method', () => {
    const { server } = makeServer()
    const api = registerCrudApi(server, [], {})
    api.addCustomEndpoint('GET', '/a', [], async () => {})
    expect(() => api.addCustomEndpoint('GET', '/b', [], async () => {})).not.toThrow()
  })
})

// ─── HalifaxApi.addCustomEndpoint — role enforcement ─────────────────────────

describe('HalifaxApi.addCustomEndpoint — role enforcement', () => {
  it('allows access when roles is empty', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {
      authStrategy: new ApiKeyAuthStrategy('k')
    })

    let reached = false
    api.addCustomEndpoint('GET', '/open', [], async (_req, res) => {
      reached = true
      await res.status(200).json({})
    })

    const req = makeReq('GET', { headers: { 'x-api-key': 'k' } })
    const { res } = makeRes()
    await invoke(routes, 'GET', '/open', req, res)
    expect(reached).toBe(true)
  })

  it('allows access when caller has a matching role', async () => {
    const { server, routes } = makeServer()
    const strategy = {
      authenticate: vi.fn().mockResolvedValue({ isAuthenticated: true, roles: ['analyst'] })
    }
    const api = registerCrudApi(server, [], { authStrategy: strategy })

    let reached = false
    api.addCustomEndpoint('GET', '/protected', ['analyst'], async (_req, res) => {
      reached = true
      await res.status(200).json({})
    })

    const { res } = makeRes()
    await invoke(routes, 'GET', '/protected', makeReq('GET'), res)
    expect(reached).toBe(true)
  })

  it('allows access when caller has a matching permission (not role)', async () => {
    const { server, routes } = makeServer()
    const strategy = {
      authenticate: vi.fn().mockResolvedValue({
        isAuthenticated: true,
        roles: [],
        permissions: ['reports:read']
      })
    }
    const api = registerCrudApi(server, [], { authStrategy: strategy })

    let reached = false
    api.addCustomEndpoint('GET', '/report', ['reports:read'], async (_req, res) => {
      reached = true
      await res.status(200).json({})
    })

    const { res } = makeRes()
    await invoke(routes, 'GET', '/report', makeReq('GET'), res)
    expect(reached).toBe(true)
  })

  it('returns 403 when caller lacks all required roles', async () => {
    const { server, routes } = makeServer()
    const strategy = {
      authenticate: vi.fn().mockResolvedValue({ isAuthenticated: true, roles: ['viewer'] })
    }
    const api = registerCrudApi(server, [], { authStrategy: strategy })

    api.addCustomEndpoint('GET', '/admin', ['admin'], async (_req, res) => {
      await res.status(200).json({})
    })

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/admin', makeReq('GET'), res)
    expect(sent.status).toBe(403)
  })

  it('returns 401 when no API key is provided (authentication failure)', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {
      authStrategy: new ApiKeyAuthStrategy('secret')
    })

    api.addCustomEndpoint('GET', '/secure', ['admin'], async (_req, res) => {
      await res.status(200).json({})
    })

    // No key supplied — ApiKeyAuthStrategy throws AuthenticationError (401)
    const req = makeReq('GET', { headers: {} })
    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/secure', req, res)
    expect(sent.status).toBe(401)
  })

  it('returns 403 when a wrong API key is provided', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {
      authStrategy: new ApiKeyAuthStrategy('secret')
    })

    api.addCustomEndpoint('GET', '/gated', ['admin'], async (_req, res) => {
      await res.status(200).json({})
    })

    // Wrong key — ApiKeyAuthStrategy throws AuthorizationError (403)
    const req = makeReq('GET', { headers: { 'x-api-key': 'wrong' } })
    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/gated', req, res)
    expect(sent.status).toBe(403)
  })

  it('OR logic — any single matching role grants access', async () => {
    const { server, routes } = makeServer()
    const strategy = {
      authenticate: vi.fn().mockResolvedValue({ isAuthenticated: true, roles: ['billing'] })
    }
    const api = registerCrudApi(server, [], { authStrategy: strategy })

    let reached = false
    api.addCustomEndpoint('GET', '/either', ['admin', 'billing'], async (_req, res) => {
      reached = true
      await res.status(200).json({})
    })

    const { res } = makeRes()
    await invoke(routes, 'GET', '/either', makeReq('GET'), res)
    expect(reached).toBe(true)
  })
})

// ─── HalifaxApi.addCustomEndpoint — OpenAPI spec mutation ────────────────────

describe('HalifaxApi.addCustomEndpoint — OpenAPI spec mutation', () => {
  function makeOpenApiServer() {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {
      openapi: { enabled: true, title: 'Test API' }
    })
    return { server, routes, api }
  }

  it('adds the operation to spec.paths when openapi metadata is provided', async () => {
    const { routes, api } = makeOpenApiServer()
    api.addCustomEndpoint('GET', '/reports/summary', [], async () => {}, {
      summary: 'Get summary',
      tags: ['Reports']
    })

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/openapi.json', makeReq('GET'), res)
    const spec = JSON.parse(sent.body as string) as OpenApiSpec
    expect(spec.paths['/reports/summary']?.get?.summary).toBe('Get summary')
    expect(spec.paths['/reports/summary']?.get?.tags).toEqual(['Reports'])
  })

  it('defaults responses to { 200: OK } when not provided', async () => {
    const { routes, api } = makeOpenApiServer()
    api.addCustomEndpoint('POST', '/actions/trigger', [], async () => {}, {
      summary: 'Trigger action'
    })

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/openapi.json', makeReq('GET'), res)
    const spec = JSON.parse(sent.body as string) as OpenApiSpec
    expect(spec.paths['/actions/trigger']?.post?.responses?.['200']?.description).toBe('OK')
  })

  it('uses provided custom responses when given', async () => {
    const { routes, api } = makeOpenApiServer()
    api.addCustomEndpoint('DELETE', '/resources/:id', [], async () => {}, {
      responses: {
        '204': { description: 'No Content' },
        '404': { description: 'Not Found' }
      }
    })

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/openapi.json', makeReq('GET'), res)
    const spec = JSON.parse(sent.body as string) as OpenApiSpec
    expect(spec.paths['/resources/:id']?.delete?.responses?.['204']?.description).toBe('No Content')
    expect(spec.paths['/resources/:id']?.delete?.responses?.['404']?.description).toBe('Not Found')
  })

  it('merges multiple verbs under the same path', async () => {
    const { routes, api } = makeOpenApiServer()
    api.addCustomEndpoint('GET', '/things', [], async () => {}, { summary: 'List things' })
    api.addCustomEndpoint('POST', '/things', [], async () => {}, { summary: 'Create thing' })

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/openapi.json', makeReq('GET'), res)
    const spec = JSON.parse(sent.body as string) as OpenApiSpec
    expect(spec.paths['/things']?.get?.summary).toBe('List things')
    expect(spec.paths['/things']?.post?.summary).toBe('Create thing')
  })

  it('does not throw and silently skips spec mutation when openapi is disabled', () => {
    const { server } = makeServer()
    const api = registerCrudApi(server, [], { openapi: { enabled: false } })
    expect(() =>
      api.addCustomEndpoint('GET', '/no-spec', [], async () => {}, { summary: 'ignored' })
    ).not.toThrow()
  })

  it('does not add to spec when no openapi metadata is provided', async () => {
    const { routes, api } = makeOpenApiServer()
    api.addCustomEndpoint('GET', '/silent', [], async () => {})

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/openapi.json', makeReq('GET'), res)
    const spec = JSON.parse(sent.body as string) as OpenApiSpec
    expect(spec.paths['/silent']).toBeUndefined()
  })

  it('reflects custom endpoint in spec even when registered after initial setup', async () => {
    const { routes, api } = makeOpenApiServer()

    // Simulate adding the endpoint after some time has passed (spec was already built)
    api.addCustomEndpoint('GET', '/late-arrival', [], async () => {}, {
      summary: 'Registered late'
    })

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/openapi.json', makeReq('GET'), res)
    const spec = JSON.parse(sent.body as string) as OpenApiSpec
    expect(spec.paths['/late-arrival']?.get?.summary).toBe('Registered late')
  })
})

// ─── HalifaxApi — constructor guard via registerCrudApi ──────────────────────

describe('registerCrudApi — returns HalifaxApi', () => {
  it('returns a HalifaxApi instance', () => {
    const { server } = makeServer()
    const api = registerCrudApi(server, [], {})
    expect(api).toBeInstanceOf(HalifaxApi)
  })

  it('the returned instance references the original server for addCustomEndpoint', () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {})

    api.addCustomEndpoint('GET', '/verify', [], async (_req, res) => {
      await res.status(200).json({ verified: true })
    })

    expect(routes.has('GET:/verify')).toBe(true)
  })
})

// ─── HalifaxApi.addCustomEndpoint — public endpoints (auth skipped) ───────────

describe('HalifaxApi.addCustomEndpoint — public endpoints', () => {
  it('roles: null skips authentication entirely', async () => {
    const { server, routes } = makeServer()
    const authenticate = vi.fn(() => {
      throw new Error('authenticate must not be called for a public endpoint')
    })
    const api = registerCrudApi(server, [], { authStrategy: { authenticate } })

    let receivedAuth: unknown
    api.addCustomEndpoint('POST', '/login', null, async (_req, res, ctx) => {
      receivedAuth = ctx.auth
      await res.status(200).json({ ok: true })
    })

    const { res, sent } = makeRes()
    await invoke(routes, 'POST', '/login', makeReq('POST'), res)
    expect(authenticate).not.toHaveBeenCalled()
    expect(sent.status).toBe(200)
    expect(receivedAuth).toEqual({ isAuthenticated: false })
  })

  it('options { auth: false } is equivalent to public', async () => {
    const { server, routes } = makeServer()
    const authenticate = vi.fn(() => {
      throw new Error('should not authenticate')
    })
    const api = registerCrudApi(server, [], { authStrategy: { authenticate } })

    let reached = false
    api.addCustomEndpoint('GET', '/health', { auth: false }, async (_req, res) => {
      reached = true
      await res.status(200).json({ status: 'ok' })
    })

    const { res } = makeRes()
    await invoke(routes, 'GET', '/health', makeReq('GET'), res)
    expect(reached).toBe(true)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('marks a public endpoint with security: [] in the OpenAPI spec', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], { openapi: { enabled: true, title: 'T' } })
    api.addCustomEndpoint('GET', '/ping', null, async () => {}, { summary: 'Ping' })

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/openapi.json', makeReq('GET'), res)
    const spec = JSON.parse(sent.body as string) as OpenApiSpec
    expect(spec.paths['/ping']?.get?.security).toEqual([])
  })
})

// ─── HalifaxApi.addCustomEndpoint — content negotiation (consumes/produces) ───

describe('HalifaxApi.addCustomEndpoint — content negotiation', () => {
  it('consumes allows a non-JSON request body (e.g. multipart upload)', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], { authStrategy: new ApiKeyAuthStrategy('k') })

    let reached = false
    api.addCustomEndpoint(
      'POST',
      '/logo',
      { roles: [], consumes: ['multipart/form-data'] },
      async (_req, res) => {
        reached = true
        await res.status(201).json({ uploaded: true })
      }
    )

    const req = makeReq('POST', {
      headers: { 'x-api-key': 'k', 'content-type': 'multipart/form-data; boundary=xyz' }
    })
    const { res, sent } = makeRes()
    await invoke(routes, 'POST', '/logo', req, res)
    expect(reached).toBe(true)
    expect(sent.status).toBe(201)
  })

  it('still rejects an undeclared content type with 415', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], { authStrategy: new ApiKeyAuthStrategy('k') })
    api.addCustomEndpoint('POST', '/json-only', { roles: [] }, async (_req, res) => {
      await res.status(201).json({})
    })

    const req = makeReq('POST', {
      headers: { 'x-api-key': 'k', 'content-type': 'multipart/form-data; boundary=xyz' }
    })
    const { res, sent } = makeRes()
    await invoke(routes, 'POST', '/json-only', req, res)
    expect(sent.status).toBe(415)
  })

  it('produces allows a non-JSON Accept (e.g. application/pdf)', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], { authStrategy: new ApiKeyAuthStrategy('k') })

    let reached = false
    api.addCustomEndpoint(
      'GET',
      '/report.pdf',
      { roles: [], produces: ['application/pdf'] },
      async (_req, res) => {
        reached = true
        res.setHeader?.('Content-Type', 'application/pdf')
        res.send?.('%PDF-1.4')
      }
    )

    const req = makeReq('GET', { headers: { 'x-api-key': 'k', accept: 'application/pdf' } })
    const { res } = makeRes()
    await invoke(routes, 'GET', '/report.pdf', req, res)
    expect(reached).toBe(true)
  })

  it('rejects an Accept that excludes every produced type with 406', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], { authStrategy: new ApiKeyAuthStrategy('k') })
    api.addCustomEndpoint('GET', '/data', { roles: [] }, async (_req, res) => {
      await res.status(200).json({})
    })

    const req = makeReq('GET', { headers: { 'x-api-key': 'k', accept: 'text/html' } })
    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/data', req, res)
    expect(sent.status).toBe(406)
  })
})

// ─── HalifaxApi.addCustomEndpoint — authorizeCustom & authorize predicate ─────

describe('HalifaxApi.addCustomEndpoint — strategy.authorizeCustom', () => {
  it('delegates to authorizeCustom and allows when it returns true', async () => {
    const { server, routes } = makeServer()
    const authorizeCustom = vi.fn().mockResolvedValue(true)
    const strategy = {
      authenticate: vi.fn().mockResolvedValue({ isAuthenticated: true, claims: { roleValue: 2 } }),
      authorizeCustom
    }
    const api = registerCrudApi(server, [], { authStrategy: strategy })

    let reached = false
    api.addCustomEndpoint('POST', '/invite', ['role:3'], async (_req, res) => {
      reached = true
      await res.status(200).json({})
    })

    await invoke(routes, 'POST', '/invite', makeReq('POST'), makeRes().res)
    expect(reached).toBe(true)
    expect(authorizeCustom).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/invite', requiredPermissions: ['role:3'] })
    )
  })

  it('denies with 403 when authorizeCustom returns false', async () => {
    const { server, routes } = makeServer()
    const strategy = {
      authenticate: vi.fn().mockResolvedValue({ isAuthenticated: true }),
      authorizeCustom: vi.fn().mockResolvedValue(false)
    }
    const api = registerCrudApi(server, [], { authStrategy: strategy })
    api.addCustomEndpoint('GET', '/restricted', ['role:1'], async (_req, res) => {
      await res.status(200).json({})
    })

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/restricted', makeReq('GET'), res)
    expect(sent.status).toBe(403)
  })

  it('useStrategyAuthorize: false falls back to the flat OR-match', async () => {
    const { server, routes } = makeServer()
    const authorizeCustom = vi.fn().mockResolvedValue(true)
    const strategy = {
      authenticate: vi.fn().mockResolvedValue({ isAuthenticated: true, roles: ['viewer'] }),
      authorizeCustom
    }
    const api = registerCrudApi(server, [], { authStrategy: strategy })
    api.addCustomEndpoint(
      'GET',
      '/flat',
      { roles: ['admin'], useStrategyAuthorize: false },
      async (_req, res) => {
        await res.status(200).json({})
      }
    )

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/flat', makeReq('GET'), res)
    expect(authorizeCustom).not.toHaveBeenCalled()
    expect(sent.status).toBe(403)
  })

  it('a per-endpoint authorize predicate is the sole gate and overrides authorizeCustom', async () => {
    const { server, routes } = makeServer()
    const authorizeCustom = vi.fn().mockResolvedValue(true)
    const strategy = {
      authenticate: vi.fn().mockResolvedValue({ isAuthenticated: true, userId: '7' }),
      authorizeCustom
    }
    const api = registerCrudApi(server, [], { authStrategy: strategy })

    api.addCustomEndpoint(
      'GET',
      '/owned/:id',
      { authorize: ({ auth }) => auth.userId === '99' },
      async (_req, res) => {
        await res.status(200).json({})
      }
    )

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/owned/:id', makeReq('GET'), res)
    expect(authorizeCustom).not.toHaveBeenCalled()
    expect(sent.status).toBe(403)
  })
})
