import { OfetchTransport, type OfetchLike } from '@/transport/OfetchTransport.js'

type OfetchOpts = { method: string; headers?: Record<string, string>; body?: unknown; ignoreResponseError: boolean }

function makeOfetchResponse(
  options: {
    status?: number
    ok?: boolean
    data?: unknown
    textResult?: string | Error
  } = {}
) {
  const { status = 200, ok = true, data, textResult = 'text' } = options
  return {
    status,
    ok,
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    _data: data,
    text: () =>
      textResult instanceof Error ? Promise.reject(textResult) : Promise.resolve(textResult)
  }
}

function makeFetch(response = makeOfetchResponse()): {
  $fetch: OfetchLike
  rawSpy: ReturnType<typeof vi.fn>
} {
  const rawSpy = vi.fn().mockResolvedValue(response)
  return { $fetch: { raw: rawSpy }, rawSpy }
}

const BASE_REQ = {
  method: 'GET',
  url: 'https://api.example.com/items',
  headers: { Accept: 'application/json' }
}

describe('OfetchTransport', () => {
  describe('send() — request construction', () => {
    it('passes url, method, headers, body, and ignoreResponseError: true to $fetch.raw', async () => {
      const { $fetch, rawSpy } = makeFetch()
      await new OfetchTransport($fetch).send({ ...BASE_REQ, method: 'POST', body: { x: 1 } })
      expect(rawSpy).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          method: 'POST',
          headers: BASE_REQ.headers,
          body: { x: 1 },
          ignoreResponseError: true
        })
      )
    })

    it('passes undefined body through as-is (not serialized)', async () => {
      const { $fetch, rawSpy } = makeFetch()
      await new OfetchTransport($fetch).send(BASE_REQ)
      const opts = rawSpy.mock.calls[0]![1] as OfetchOpts
      expect(opts.body).toBeUndefined()
    })
  })

  describe('send() — response mapping', () => {
    it('proxies status and ok', async () => {
      const { $fetch } = makeFetch(makeOfetchResponse({ status: 403, ok: false }))
      const res = await new OfetchTransport($fetch).send(BASE_REQ)
      expect(res.status).toBe(403)
      expect(res.ok).toBe(false)
    })

    it('json() returns _data directly (already parsed by ofetch)', async () => {
      const parsed = { id: 1 }
      const { $fetch } = makeFetch(makeOfetchResponse({ data: parsed }))
      const res = await new OfetchTransport($fetch).send(BASE_REQ)
      await expect(res.json()).resolves.toBe(parsed)
    })

    it('json() returns undefined when _data is not set', async () => {
      const { $fetch } = makeFetch(makeOfetchResponse())
      const res = await new OfetchTransport($fetch).send(BASE_REQ)
      await expect(res.json()).resolves.toBeUndefined()
    })

    it('text() returns _data directly when it is a string', async () => {
      const { $fetch } = makeFetch(makeOfetchResponse({ data: 'hello' }))
      const res = await new OfetchTransport($fetch).send(BASE_REQ)
      await expect(res.text()).resolves.toBe('hello')
    })

    it('text() calls response.text() when _data is not a string', async () => {
      const { $fetch } = makeFetch(makeOfetchResponse({ data: { id: 1 }, textResult: 'raw-text' }))
      const res = await new OfetchTransport($fetch).send(BASE_REQ)
      await expect(res.text()).resolves.toBe('raw-text')
    })

    it('text() falls back to JSON.stringify when response.text() throws', async () => {
      const data = { id: 1 }
      const { $fetch } = makeFetch(
        makeOfetchResponse({ data, textResult: new Error('stream consumed') })
      )
      const res = await new OfetchTransport($fetch).send(BASE_REQ)
      await expect(res.text()).resolves.toBe(JSON.stringify(data))
    })

    it('headers.get() delegates to response.headers.get()', async () => {
      const { $fetch } = makeFetch()
      const res = await new OfetchTransport($fetch).send(BASE_REQ)
      expect(res.headers.get('content-type')).toBe('application/json')
    })
  })
})
