import type {
  HttpTransport,
  TransportRequest,
  TransportResponse
} from '@/transport/HttpTransport.js'

/**
 * Minimal structural interface for an Axios instance.
 *
 * Defined here so `@edium/halifax-client` has **no hard dependency on axios**.
 * Any object satisfying this shape works — including `axios`, `axios.create()`,
 * or a compatible mock.
 */
export interface AxiosLike {
  request(config: {
    method?: string
    url?: string
    headers?: Record<string, string>
    data?: unknown
    /**
     * Return `true` for every status so Axios does not throw on non-2xx responses.
     * `HalifaxClient` handles error responses itself via `HalifaxError`.
     */
    validateStatus?: (status: number) => boolean
  }): Promise<{
    status: number
    statusText?: string
    headers: Record<string, unknown>
    data: unknown
  }>
}

/**
 * Transport backed by an Axios instance (or any compatible HTTP client).
 *
 * Pass your own `axios.create()` so you can configure interceptors, base
 * headers, timeouts, and retry logic outside the Halifax client:
 *
 * ```ts
 * import axios from 'axios'
 * import { HalifaxClient, AxiosTransport } from '@edium/halifax-client'
 *
 * const axiosInstance = axios.create({
 *   timeout: 10_000,
 *   // Do NOT set baseURL here — HalifaxClient builds full URLs itself.
 * })
 *
 * // Intercept every request to attach the latest auth token.
 * axiosInstance.interceptors.request.use((config) => {
 *   const token = getToken()
 *   if (token) config.headers['Authorization'] = `Bearer ${token}`
 *   return config
 * })
 *
 * const client = new HalifaxClient({
 *   baseUrl: 'https://api.example.com',
 *   transport: new AxiosTransport(axiosInstance)
 * })
 * ```
 */
export class AxiosTransport implements HttpTransport {
  constructor(private readonly axios: AxiosLike) {}

  async send(req: TransportRequest): Promise<TransportResponse> {
    const response = await this.axios.request({
      method: req.method,
      url: req.url,
      headers: req.headers,
      // Pass body as `data` — Axios serialises it to JSON automatically when
      // Content-Type: application/json is present (set by HalifaxClient).
      data: req.body,
      // Never let Axios throw on non-2xx; HalifaxClient inspects status itself.
      validateStatus: () => true
    })

    const data = response.data

    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      headers: {
        get: (name: string) => {
          const val = response.headers[name.toLowerCase()]
          return typeof val === 'string' ? val : null
        }
      },
      json: async () => data,
      text: async () => (typeof data === 'string' ? data : JSON.stringify(data))
    }
  }
}
