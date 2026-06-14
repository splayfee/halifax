import { HalifaxClient } from '@/HalifaxClient'
import { HalifaxError } from '@/errors/HalifaxError'
import type { HttpTransport, TransportRequest, TransportResponse } from '@/transport/HttpTransport'

function makeResponse(
  options: {
    status?: number
    ok?: boolean
    contentType?: string
    body?: unknown
    text?: string
  } = {}
): TransportResponse {
  const {
    status = 200,
    ok = true,
    contentType = 'application/json',
    body = {},
    text = ''
  } = options
  return {
    status,
    ok,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null)
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(text)
  }
}

function makeTransport(response = makeResponse()): {
  transport: HttpTransport
  spy: ReturnType<typeof vi.fn>
} {
  const spy = vi.fn().mockResolvedValue(response)
  return { transport: { send: spy }, spy }
}

describe('HalifaxClient — constructor', () => {
  it('strips trailing slash from baseUrl', async () => {
    const { transport, spy } = makeTransport()
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com/', transport })
    client.resource('users').getOne(1)
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    const [req] = spy.mock.calls[0]! as [TransportRequest]
    expect(req.url).toBe('https://api.example.com/users/1')
  })

  it('preserves baseUrl without trailing slash', async () => {
    const { transport, spy } = makeTransport()
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    client.resource('posts').getOne(2)
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    const [req] = spy.mock.calls[0]! as [TransportRequest]
    expect(req.url).toBe('https://api.example.com/posts/2')
  })

  it('uses custom queryBuilderPath when provided', async () => {
    const { transport, spy } = makeTransport(makeResponse({ body: { data: [] } }))
    const client = new HalifaxClient({
      baseUrl: 'https://api.example.com',
      transport,
      queryBuilderPath: 'search'
    })
    await client.resource('posts').query({})
    const [req] = spy.mock.calls[0]! as [TransportRequest]
    expect(req.url).toContain('/posts/search')
  })

  it('defaults queryBuilderPath to "query"', async () => {
    const { transport, spy } = makeTransport(makeResponse({ body: { data: [] } }))
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    await client.resource('posts').query({})
    const [req] = spy.mock.calls[0]! as [TransportRequest]
    expect(req.url).toContain('/posts/query')
  })
})

describe('HalifaxClient — request headers', () => {
  it('always sends Accept: application/json', async () => {
    const { transport, spy } = makeTransport()
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    await client.resource('users').getOne(1)
    expect((spy.mock.calls[0]![0] as TransportRequest).headers).toMatchObject({ Accept: 'application/json' })
  })

  it('sends Content-Type: application/json when body is present', async () => {
    const { transport, spy } = makeTransport()
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    await client.resource('users').createOne({ name: 'alice' })
    expect((spy.mock.calls[0]![0] as TransportRequest).headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('does NOT send Content-Type when body is absent', async () => {
    const { transport, spy } = makeTransport()
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    await client.resource('users').getOne(1)
    expect((spy.mock.calls[0]![0] as TransportRequest).headers).not.toHaveProperty('Content-Type')
  })

  it('merges static extra headers', async () => {
    const { transport, spy } = makeTransport()
    const client = new HalifaxClient({
      baseUrl: 'https://api.example.com',
      transport,
      headers: { Authorization: 'Bearer tok' }
    })
    await client.resource('users').getOne(1)
    expect((spy.mock.calls[0]![0] as TransportRequest).headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  it('calls async header function before every request', async () => {
    const { transport, spy } = makeTransport()
    const headerFn = vi.fn().mockResolvedValue({ Authorization: 'Bearer dyn' })
    const client = new HalifaxClient({
      baseUrl: 'https://api.example.com',
      transport,
      headers: headerFn
    })
    await client.resource('users').getOne(1)
    expect(headerFn).toHaveBeenCalledTimes(1)
    expect((spy.mock.calls[0]![0] as TransportRequest).headers).toMatchObject({ Authorization: 'Bearer dyn' })
  })

  it('calls sync header function', async () => {
    const { transport, spy } = makeTransport()
    const client = new HalifaxClient({
      baseUrl: 'https://api.example.com',
      transport,
      headers: () => ({ 'X-Tenant': 'acme' })
    })
    await client.resource('users').getOne(1)
    expect((spy.mock.calls[0]![0] as TransportRequest).headers).toMatchObject({ 'X-Tenant': 'acme' })
  })
})

describe('HalifaxClient — response handling', () => {
  it('returns parsed JSON body on success', async () => {
    const { transport } = makeTransport(makeResponse({ body: { id: 1, name: 'alice' } }))
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    const result = await client.resource<{ id: number; name: string }>('users').getOne(1)
    expect(result).toEqual({ id: 1, name: 'alice' })
  })

  it('returns text body when content-type is not application/json', async () => {
    const { transport } = makeTransport(makeResponse({ contentType: 'text/plain', text: 'hello' }))
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    const result = await client.resource<string>('ping').getOne(1)
    expect(result).toBe('hello')
  })
})

describe('HalifaxClient — envelope unwrapping', () => {
  it('unwraps the envelope key when set', async () => {
    const body = { data: { id: 1 }, meta: {} }
    const { transport } = makeTransport(makeResponse({ body }))
    const client = new HalifaxClient({
      baseUrl: 'https://api.example.com',
      transport,
      envelope: 'data'
    })
    const result = await client.resource<{ id: number }>('users').getOne(1)
    expect(result).toEqual({ id: 1 })
  })

  it('returns the full payload when envelope key is absent', async () => {
    const body = { id: 1, name: 'alice' }
    const { transport } = makeTransport(makeResponse({ body }))
    const client = new HalifaxClient({
      baseUrl: 'https://api.example.com',
      transport,
      envelope: 'data'
    })
    const result = await client.resource<typeof body>('users').getOne(1)
    expect(result).toEqual(body)
  })

  it('returns the full payload when no envelope is configured', async () => {
    const body = { data: [{ id: 1 }], total: 1 }
    const { transport } = makeTransport(makeResponse({ body }))
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    const result = await client.resource<typeof body>('users').getOne(1)
    expect(result).toEqual(body)
  })
})

describe('HalifaxClient — error handling', () => {
  it('throws HalifaxError on non-ok response with errors array', async () => {
    const body = { errors: [{ code: 'NOT_FOUND', message: 'Not found' }] }
    const { transport } = makeTransport(makeResponse({ status: 404, ok: false, body }))
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    await expect(client.resource('users').getOne(99)).rejects.toBeInstanceOf(HalifaxError)
  })

  it('sets the status and errors on the thrown HalifaxError', async () => {
    const body = { errors: [{ code: 'NOT_FOUND', message: 'Not found' }] }
    const { transport } = makeTransport(makeResponse({ status: 404, ok: false, body }))
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    try {
      await client.resource('users').getOne(99)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(HalifaxError)
      const he = err as HalifaxError
      expect(he.status).toBe(404)
      expect(he.errors[0]!.code).toBe('NOT_FOUND')
    }
  })

  it('falls back to UNKNOWN error when body has no errors array', async () => {
    const { transport } = makeTransport(
      makeResponse({
        status: 500,
        ok: false,
        body: 'Internal Server Error',
        contentType: 'text/plain'
      })
    )
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    try {
      await client.resource('users').getOne(1)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(HalifaxError)
      const he = err as HalifaxError
      expect(he.status).toBe(500)
      expect(he.errors[0]!.code).toBe('UNKNOWN')
      expect(he.errors[0]!.message).toBe('HTTP 500')
    }
  })

  it('falls back to UNKNOWN when body is not an object', async () => {
    const { transport } = makeTransport(makeResponse({ status: 503, ok: false, body: null }))
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    try {
      await client.resource('users').getOne(1)
      expect.fail('should have thrown')
    } catch (err) {
      const he = err as HalifaxError
      expect(he.errors[0]!.code).toBe('UNKNOWN')
    }
  })
})

describe('HalifaxClient — resource()', () => {
  it('returns a ResourceClient with the given prefix', async () => {
    const { transport, spy } = makeTransport()
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    const users = client.resource('users')
    await users.getOne(1)
    expect((spy.mock.calls[0]![0] as TransportRequest).url).toContain('/users/1')
  })

  it('returns independent ResourceClients for different prefixes', async () => {
    const { transport, spy } = makeTransport()
    spy.mockResolvedValue(makeResponse())
    const client = new HalifaxClient({ baseUrl: 'https://api.example.com', transport })
    const users = client.resource('users')
    const posts = client.resource('posts')
    await users.getOne(1)
    await posts.getOne(2)
    expect((spy.mock.calls[0]![0] as TransportRequest).url).toContain('/users/1')
    expect((spy.mock.calls[1]![0] as TransportRequest).url).toContain('/posts/2')
  })
})
