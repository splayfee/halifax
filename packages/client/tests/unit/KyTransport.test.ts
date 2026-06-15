import { KyTransport, type KyLike } from '@/transport/KyTransport.js'

type KyOpts = {
  method: string
  headers?: Record<string, string>
  throwHttpErrors: boolean
  body?: string
}

function makeKyResponse(
  options: { status?: number; ok?: boolean; body?: unknown; text?: string } = {}
) {
  const { status = 200, ok = true, body = {}, text = '' } = options
  return {
    status,
    ok,
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(text)
  }
}

function makeKy(response = makeKyResponse()): { ky: KyLike; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn().mockResolvedValue(response)
  return { ky: spy as unknown as KyLike, spy }
}

const BASE_REQ = {
  method: 'GET',
  url: 'https://api.example.com/items',
  headers: { Accept: 'application/json' }
}

describe('KyTransport', () => {
  describe('send() — request construction', () => {
    it('passes url, method, headers and throwHttpErrors: false', async () => {
      const { ky, spy } = makeKy()
      await new KyTransport(ky).send(BASE_REQ)
      expect(spy).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' },
          throwHttpErrors: false
        })
      )
    })

    it('does not include body key when req.body is undefined', async () => {
      const { ky, spy } = makeKy()
      await new KyTransport(ky).send(BASE_REQ)
      const opts = spy.mock.calls[0]![1] as KyOpts
      expect('body' in opts).toBe(false)
    })

    it('includes body as JSON string when req.body is defined', async () => {
      const { ky, spy } = makeKy()
      await new KyTransport(ky).send({ ...BASE_REQ, method: 'POST', body: { name: 'alice' } })
      const opts = spy.mock.calls[0]![1] as KyOpts
      expect(opts.body).toBe('{"name":"alice"}')
    })

    it('serializes falsy body values (null, 0, false)', async () => {
      const { ky, spy } = makeKy()
      for (const body of [null, 0, false] as const) {
        spy.mockResolvedValueOnce(makeKyResponse())
        await new KyTransport(ky).send({ ...BASE_REQ, method: 'POST', body })
        const opts = spy.mock.calls.at(-1)![1] as KyOpts
        expect(opts.body).toBe(JSON.stringify(body))
      }
    })
  })

  describe('send() — response mapping', () => {
    it('proxies status and ok from the ky response', async () => {
      const { ky } = makeKy(makeKyResponse({ status: 404, ok: false }))
      const res = await new KyTransport(ky).send(BASE_REQ)
      expect(res.status).toBe(404)
      expect(res.ok).toBe(false)
    })

    it('headers.get() delegates to the ky response headers', async () => {
      const { ky } = makeKy()
      const res = await new KyTransport(ky).send(BASE_REQ)
      expect(res.headers.get('content-type')).toBe('application/json')
    })

    it('json() returns the ky response json()', async () => {
      const payload = { id: 1 }
      const { ky } = makeKy(makeKyResponse({ body: payload }))
      const res = await new KyTransport(ky).send(BASE_REQ)
      await expect(res.json()).resolves.toEqual(payload)
    })

    it('text() returns the ky response text()', async () => {
      const { ky } = makeKy(makeKyResponse({ text: 'raw' }))
      const res = await new KyTransport(ky).send(BASE_REQ)
      await expect(res.text()).resolves.toBe('raw')
    })
  })
})
