import { AxiosTransport, type AxiosLike } from '@/transport/AxiosTransport'

function makeAxiosResponse(options: {
  status?: number
  headers?: Record<string, unknown>
  data?: unknown
}) {
  return {
    status: options.status ?? 200,
    headers: options.headers ?? { 'content-type': 'application/json' },
    data: options.data !== undefined ? options.data : {}
  }
}

function makeAxios(response?: ReturnType<typeof makeAxiosResponse>): {
  axios: AxiosLike
  requestSpy: ReturnType<typeof vi.fn>
} {
  const requestSpy = vi.fn().mockResolvedValue(response ?? makeAxiosResponse({}))
  return { axios: { request: requestSpy }, requestSpy }
}

const BASE_REQ = {
  method: 'GET',
  url: 'https://api.example.com/users',
  headers: { Accept: 'application/json' }
}

describe('AxiosTransport', () => {
  describe('send() — request forwarding', () => {
    it('passes method, url, and headers to axios.request', async () => {
      const { axios, requestSpy } = makeAxios()
      await new AxiosTransport(axios).send(BASE_REQ)
      expect(requestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'https://api.example.com/users',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('passes body as `data`', async () => {
      const { axios, requestSpy } = makeAxios()
      await new AxiosTransport(axios).send({ ...BASE_REQ, method: 'POST', body: { name: 'alice' } })
      expect(requestSpy).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'alice' } }))
    })

    it('always passes validateStatus that returns true', async () => {
      type AxiosConfig = {
        method?: string
        url?: string
        headers?: Record<string, string>
        data?: unknown
        validateStatus?: (status: number) => boolean
      }
      const { axios, requestSpy } = makeAxios()
      await new AxiosTransport(axios).send(BASE_REQ)
      const config = requestSpy.mock.calls[0]![0] as AxiosConfig
      const { validateStatus } = config
      expect(typeof validateStatus).toBe('function')
      expect(validateStatus!(200)).toBe(true)
      expect(validateStatus!(404)).toBe(true)
      expect(validateStatus!(500)).toBe(true)
    })
  })

  describe('send() — response mapping', () => {
    it('computes ok: true for 2xx status', async () => {
      const { axios } = makeAxios(makeAxiosResponse({ status: 200 }))
      const res = await new AxiosTransport(axios).send(BASE_REQ)
      expect(res.ok).toBe(true)
    })

    it('computes ok: false for 4xx status', async () => {
      const { axios } = makeAxios(makeAxiosResponse({ status: 404 }))
      const res = await new AxiosTransport(axios).send(BASE_REQ)
      expect(res.ok).toBe(false)
    })

    it('computes ok: false for 5xx status', async () => {
      const { axios } = makeAxios(makeAxiosResponse({ status: 500 }))
      const res = await new AxiosTransport(axios).send(BASE_REQ)
      expect(res.ok).toBe(false)
    })

    it('headers.get() does case-insensitive lookup', async () => {
      const { axios } = makeAxios(
        makeAxiosResponse({ headers: { 'content-type': 'application/json' } })
      )
      const res = await new AxiosTransport(axios).send(BASE_REQ)
      expect(res.headers.get('Content-Type')).toBe('application/json')
      expect(res.headers.get('content-type')).toBe('application/json')
    })

    it('headers.get() returns null when header is missing', async () => {
      const { axios } = makeAxios(makeAxiosResponse({ headers: {} }))
      const res = await new AxiosTransport(axios).send(BASE_REQ)
      expect(res.headers.get('x-missing')).toBeNull()
    })

    it('headers.get() returns null when header value is not a string', async () => {
      const { axios } = makeAxios(makeAxiosResponse({ headers: { 'x-count': 42 } }))
      const res = await new AxiosTransport(axios).send(BASE_REQ)
      expect(res.headers.get('x-count')).toBeNull()
    })

    it('json() returns data directly (already parsed)', async () => {
      const data = { id: 1 }
      const { axios } = makeAxios(makeAxiosResponse({ data }))
      const res = await new AxiosTransport(axios).send(BASE_REQ)
      await expect(res.json()).resolves.toBe(data)
    })

    it('text() returns data as string when data is a string', async () => {
      const { axios } = makeAxios(makeAxiosResponse({ data: 'hello' }))
      const res = await new AxiosTransport(axios).send(BASE_REQ)
      await expect(res.text()).resolves.toBe('hello')
    })

    it('text() JSON-stringifies data when data is not a string', async () => {
      const data = { id: 1 }
      const { axios } = makeAxios(makeAxiosResponse({ data }))
      const res = await new AxiosTransport(axios).send(BASE_REQ)
      await expect(res.text()).resolves.toBe(JSON.stringify(data))
    })

    it('text() handles null data via JSON.stringify', async () => {
      const { axios } = makeAxios(makeAxiosResponse({ data: null }))
      const res = await new AxiosTransport(axios).send(BASE_REQ)
      await expect(res.text()).resolves.toBe('null')
    })
  })
})
