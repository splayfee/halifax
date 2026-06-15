import type { HttpTransport, TransportRequest, TransportResponse } from '@/transport/HttpTransport.js'

/**
 * Minimal structural interface for a ky instance.
 *
 * Defined here so `@edium/halifax-client` has **no hard dependency on ky**.
 * `ky` and `ky.create(...)` both satisfy this shape.
 */
export interface KyLike {
  (
    url: string,
    options?: {
      method?: string
      headers?: Record<string, string>
      body?: string
      throwHttpErrors?: boolean
    }
  ): Promise<{
    status: number
    ok: boolean
    headers: { get(name: string): string | null }
    json(): Promise<unknown>
    text(): Promise<string>
  }>
}

/**
 * Transport backed by a ky instance.
 *
 * Pass `ky.create(...)` so you can configure hooks, prefixUrl, and retry
 * logic outside the Halifax client:
 *
 * ```ts
 * import ky from 'ky'
 * import { HalifaxClient, KyTransport } from '@edium/halifax-client'
 *
 * const kyInstance = ky.create({
 *   retry: { limit: 2, methods: ['get'] },
 *   hooks: {
 *     beforeRequest: [
 *       (request) => {
 *         request.headers.set('Authorization', `Bearer ${getToken()}`)
 *       }
 *     ]
 *   }
 * })
 *
 * const client = new HalifaxClient({
 *   baseUrl: 'https://api.example.com',
 *   transport: new KyTransport(kyInstance)
 * })
 * ```
 *
 * Note: do NOT set `prefixUrl` on the ky instance — HalifaxClient builds
 * absolute URLs itself and passes them directly to the transport.
 */
export class KyTransport implements HttpTransport {
  constructor(private readonly ky: KyLike) {}

  async send(req: TransportRequest): Promise<TransportResponse> {
    const response = await this.ky(req.url, {
      method: req.method,
      headers: req.headers,
      // Pass body as a pre-serialised string to avoid Content-Type conflicts
      // with ky's own `json` option. HalifaxClient already sets the header.
      // Spread conditionally to satisfy exactOptionalPropertyTypes.
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      throwHttpErrors: false
    })

    return {
      status: response.status,
      ok: response.ok,
      headers: { get: (name) => response.headers.get(name) },
      json: () => response.json(),
      text: () => response.text()
    }
  }
}
