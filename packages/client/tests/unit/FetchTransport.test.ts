import { FetchTransport } from '@/transport/FetchTransport'

/** Minimal mock for a fetch Response. */
function makeFetchResponse(options: {
  status?: number
  ok?: boolean
  contentType?: string | null
  body?: unknown
  text?: string
}): Response {
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
  } as unknown as Response
}

const BASE_REQ = {
  method: 'GET',
  url: 'https://api.example.com/users',
  headers: { Accept: 'application/json' }
}

describe('FetchTransport', () => {
  describe('constructor', () => {
    it('uses a custom fetchFn when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse({}))
      const transport = new FetchTransport(mockFetch)
      await transport.send(BASE_REQ)
      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('falls back to globalThis.fetch when no fetchFn is given', async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse({}))
      vi.stubGlobal('fetch', mockFetch)
      const transport = new FetchTransport()
      await transport.send(BASE_REQ)
      expect(mockFetch).toHaveBeenCalledOnce()
      vi.unstubAllGlobals()
    })
  })

  describe('send() — request construction', () => {
    it('passes method, url, and headers to fetchFn', async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse({}))
      const transport = new FetchTransport(mockFetch)
      await transport.send({
        method: 'POST',
        url: 'https://api.example.com/users',
        headers: { Authorization: 'Bearer tok' }
      })
      const [url, init] = mockFetch.mock.calls[0]! as [string, RequestInit]
      expect(url).toBe('https://api.example.com/users')
      expect(init.method).toBe('POST')
      expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' })
    })

    it('does not set body when req.body is undefined', async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse({}))
      const transport = new FetchTransport(mockFetch)
      await transport.send(BASE_REQ)
      const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit]
      expect(init.body).toBeUndefined()
    })

    it('JSON-serializes req.body when present', async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse({}))
      const transport = new FetchTransport(mockFetch)
      await transport.send({ ...BASE_REQ, method: 'POST', body: { name: 'alice' } })
      const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit]
      expect(init.body).toBe('{"name":"alice"}')
    })

    it('serializes falsy body values (0, false, null) that are not undefined', async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse({}))
      const transport = new FetchTransport(mockFetch)
      for (const body of [0, false, null]) {
        mockFetch.mockResolvedValueOnce(makeFetchResponse({}))
        await transport.send({ ...BASE_REQ, method: 'POST', body })
        const call = mockFetch.mock.calls.at(-1)!
        expect((call[1] as RequestInit).body).toBe(JSON.stringify(body))
      }
    })
  })

  describe('send() — response mapping', () => {
    it('maps status and ok from the native response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse({ status: 201, ok: true }))
      const transport = new FetchTransport(mockFetch)
      const res = await transport.send(BASE_REQ)
      expect(res.status).toBe(201)
      expect(res.ok).toBe(true)
    })

    it('headers.get() proxies to the native response headers', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(makeFetchResponse({ contentType: 'application/json; charset=utf-8' }))
      const transport = new FetchTransport(mockFetch)
      const res = await transport.send(BASE_REQ)
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    })

    it('json() returns the parsed JSON body', async () => {
      const payload = { id: 1, name: 'alice' }
      const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse({ body: payload }))
      const transport = new FetchTransport(mockFetch)
      const res = await transport.send(BASE_REQ)
      await expect(res.json()).resolves.toEqual(payload)
    })

    it('text() returns the text body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse({ text: 'hello' }))
      const transport = new FetchTransport(mockFetch)
      const res = await transport.send(BASE_REQ)
      await expect(res.text()).resolves.toBe('hello')
    })

    it('propagates a rejected fetch promise', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      const transport = new FetchTransport(mockFetch)
      await expect(transport.send(BASE_REQ)).rejects.toThrow('Network error')
    })
  })
})
