import { describe, it, expect } from 'vitest'
import { registerCrudApi } from '@/core/crudRouter.js'
import { yupValidator } from '@edium/halifax-types/yup'
import { zodValidator } from '@edium/halifax-types/zod'
import * as yup from 'yup'
import { z } from 'zod'
import type { HttpMethod, HttpRequest, HttpResponse, HttpServer } from '@/core/types.js'

// ─── Minimal harness ──────────────────────────────────────────────────────────

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

// ─── Validation ────────────────────────────────────────────────────────────────

describe('custom endpoint — request validation', () => {
  it('coerces and forwards a valid body to the handler', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {})
    let received: unknown
    api.addCustomEndpoint(
      'POST',
      '/things',
      {
        roles: [],
        validate: { body: yupValidator(yup.object({ qty: yup.number().required() })) }
      },
      async (req, res) => {
        received = req.body
        await res.status(201).json({ ok: true })
      }
    )

    // qty arrives as a string; yup coercion should turn it into a number.
    const req = makeReq('POST', { body: { qty: '5', extra: 'dropped' } })
    const { res, sent } = makeRes()
    await invoke(routes, 'POST', '/things', req, res)

    expect(sent.status).toBe(201)
    expect(received).toEqual({ qty: 5 }) // coerced + stripUnknown
  })

  it('rejects an invalid body with 422 and prefixed field errors', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {})
    let handlerRan = false
    api.addCustomEndpoint(
      'POST',
      '/things',
      { roles: [], validate: { body: yupValidator(yup.object({ qty: yup.number().required() })) } },
      async () => {
        handlerRan = true
      }
    )

    const req = makeReq('POST', { body: {} })
    const { res, sent } = makeRes()
    await invoke(routes, 'POST', '/things', req, res)

    expect(sent.status).toBe(422)
    expect(handlerRan).toBe(false)
    const body = sent.body as {
      errors: Array<{ details?: { fieldErrors?: Array<{ path: string }> } }>
    }
    expect(body.errors[0]?.details?.fieldErrors?.[0]?.path).toBe('body.qty')
  })

  it('validates query params and prefixes their errors with "query."', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], {})
    api.addCustomEndpoint(
      'GET',
      '/search',
      { roles: [], validate: { query: zodValidator(z.object({ limit: z.coerce.number() })) } },
      async (_req, res) => {
        await res.status(200).json({ ok: true })
      }
    )

    const req = makeReq('GET', { query: { limit: 'abc' } })
    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/search', req, res)

    expect(sent.status).toBe(422)
    const body = sent.body as {
      errors: Array<{ details?: { fieldErrors?: Array<{ path: string }> } }>
    }
    expect(body.errors[0]?.details?.fieldErrors?.[0]?.path).toBe('query.limit')
  })
})

// ─── Auto-OpenAPI from schemas ──────────────────────────────────────────────────

describe('custom endpoint — auto OpenAPI from schema', () => {
  it('derives requestBody from a body schema that can emit JSON Schema (zod)', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], { openapi: { enabled: true } })
    api.addCustomEndpoint(
      'POST',
      '/orders',
      {
        roles: [],
        validate: { body: zodValidator(z.object({ sku: z.string(), qty: z.number() })) }
      },
      async (_req, res) => {
        await res.status(201).json({ ok: true })
      }
    )

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/openapi.json', makeReq('GET'), res)
    // The spec route sends a JSON string.
    const spec = JSON.parse(sent.body as string) as {
      paths: Record<
        string,
        { post?: { requestBody?: { content: Record<string, { schema: { type?: string } }> } } }
      >
    }
    const schema = spec.paths['/orders']?.post?.requestBody?.content['application/json']?.schema
    expect(schema?.type).toBe('object')
  })

  it('derives requestBody from a Yup body schema too (Yup→JSON-Schema)', async () => {
    const { server, routes } = makeServer()
    const api = registerCrudApi(server, [], { openapi: { enabled: true } })
    api.addCustomEndpoint(
      'POST',
      '/y',
      { roles: [], validate: { body: yupValidator(yup.object({ a: yup.string().required() })) } },
      async (_req, res) => {
        await res.status(201).json({ ok: true })
      }
    )

    const { res, sent } = makeRes()
    await invoke(routes, 'GET', '/openapi.json', makeReq('GET'), res)
    const spec = JSON.parse(sent.body as string) as {
      paths: Record<
        string,
        {
          post?: {
            requestBody?: {
              content: Record<
                string,
                { schema: { type?: string; properties?: Record<string, unknown> } }
              >
            }
          }
        }
      >
    }
    const schema = spec.paths['/y']?.post?.requestBody?.content['application/json']?.schema
    expect(schema?.type).toBe('object')
    expect(schema?.properties).toHaveProperty('a')
  })
})
