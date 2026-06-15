import {
  SuperagentTransport,
  type SuperagentLike,
  type SuperagentRequest
} from '@/transport/SuperagentTransport'

function makeRequest(response: {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: unknown
  text: string
}): SuperagentRequest {
  const chain = {
    set: vi.fn().mockReturnThis(),
    ok: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    then<TResult1 = typeof response, TResult2 = never>(
      onfulfilled?: ((value: typeof response) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return Promise.resolve(response).then(onfulfilled, onrejected)
    }
  }
  return chain as unknown as SuperagentRequest
}

function makeAgent(response: {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: unknown
  text: string
}): {
  superagent: SuperagentLike
  requestChain: SuperagentRequest
} {
  const requestChain = makeRequest(response)
  const superagent = vi.fn().mockReturnValue(requestChain) as unknown as SuperagentLike
  return { superagent, requestChain }
}

const RESPONSE = {
  status: 200,
  ok: true,
  headers: { 'content-type': 'application/json' },
  body: { id: 1 },
  text: 'raw'
}
const BASE_REQ = {
  method: 'GET',
  url: 'https://api.example.com/items',
  headers: { Accept: 'application/json' }
}

describe('SuperagentTransport', () => {
  describe('send() — request construction', () => {
    it('calls superagent with method and url', async () => {
      const { superagent } = makeAgent(RESPONSE)
      await new SuperagentTransport(superagent).send(BASE_REQ)
      expect(superagent).toHaveBeenCalledWith('GET', 'https://api.example.com/items')
    })

    it('chains .set(headers)', async () => {
      const { superagent, requestChain } = makeAgent(RESPONSE)
      await new SuperagentTransport(superagent).send(BASE_REQ)
      expect(requestChain.set).toHaveBeenCalledWith({ Accept: 'application/json' })
    })

    it('chains .ok(() => true) — always returns true', async () => {
      const { superagent, requestChain } = makeAgent(RESPONSE)
      await new SuperagentTransport(superagent).send(BASE_REQ)
      const okFn = (requestChain.ok as ReturnType<typeof vi.fn>).mock.calls[0]![0] as () => boolean
      expect(typeof okFn).toBe('function')
      expect(okFn()).toBe(true)
    })

    it('does NOT call .send() when body is undefined', async () => {
      const { superagent, requestChain } = makeAgent(RESPONSE)
      await new SuperagentTransport(superagent).send(BASE_REQ)
      expect(requestChain.send).not.toHaveBeenCalled()
    })

    it('calls .send(body) when body is defined', async () => {
      const { superagent, requestChain } = makeAgent(RESPONSE)
      await new SuperagentTransport(superagent).send({
        ...BASE_REQ,
        method: 'POST',
        body: { name: 'alice' }
      })
      expect(requestChain.send).toHaveBeenCalledWith({ name: 'alice' })
    })
  })

  describe('send() — response mapping', () => {
    it('proxies status and ok from the superagent response', async () => {
      const { superagent } = makeAgent({ ...RESPONSE, status: 404, ok: false })
      const res = await new SuperagentTransport(superagent).send(BASE_REQ)
      expect(res.status).toBe(404)
      expect(res.ok).toBe(false)
    })

    it('headers.get() does lowercase lookup on superagent headers', async () => {
      const { superagent } = makeAgent({
        ...RESPONSE,
        headers: { 'content-type': 'application/json' }
      })
      const res = await new SuperagentTransport(superagent).send(BASE_REQ)
      expect(res.headers.get('Content-Type')).toBe('application/json')
      expect(res.headers.get('content-type')).toBe('application/json')
    })

    it('headers.get() returns null when header is absent', async () => {
      const { superagent } = makeAgent({ ...RESPONSE, headers: {} })
      const res = await new SuperagentTransport(superagent).send(BASE_REQ)
      expect(res.headers.get('x-missing')).toBeNull()
    })

    it('json() returns response.body (already parsed)', async () => {
      const body = { id: 99 }
      const { superagent } = makeAgent({ ...RESPONSE, body })
      const res = await new SuperagentTransport(superagent).send(BASE_REQ)
      await expect(res.json()).resolves.toBe(body)
    })

    it('text() returns response.text', async () => {
      const { superagent } = makeAgent({ ...RESPONSE, text: 'hello world' })
      const res = await new SuperagentTransport(superagent).send(BASE_REQ)
      await expect(res.text()).resolves.toBe('hello world')
    })
  })
})
