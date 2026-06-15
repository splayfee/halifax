import type {
  HttpTransport,
  TransportRequest,
  TransportResponse
} from '@/transport/HttpTransport.js'

/**
 * Transport backed by the browser (or Node 18+) `fetch` API.
 *
 * This is the default transport used when no `transport` option is passed to
 * `HalifaxClient`. You can supply a custom `fetch` function to add
 * middleware, use `node-fetch`, or intercept requests in tests:
 *
 * ```ts
 * import { HalifaxClient, FetchTransport } from '@edium/halifax-client'
 *
 * // Custom fetch with a timeout
 * function fetchWithTimeout(input: RequestInfo, init?: RequestInit) {
 *   const controller = new AbortController()
 *   const id = setTimeout(() => controller.abort(), 5000)
 *   return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(id))
 * }
 *
 * const client = new HalifaxClient({
 *   baseUrl: 'https://api.example.com',
 *   transport: new FetchTransport(fetchWithTimeout)
 * })
 * ```
 */
export class FetchTransport implements HttpTransport {
  private readonly fetchFn: typeof globalThis.fetch

  constructor(fetchFn?: typeof globalThis.fetch) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis)
  }

  async send(req: TransportRequest): Promise<TransportResponse> {
    const init: RequestInit = {
      method: req.method,
      headers: req.headers
    }
    if (req.body !== undefined) {
      init.body = JSON.stringify(req.body)
    }

    const res = await this.fetchFn(req.url, init)
    return {
      status: res.status,
      ok: res.ok,
      headers: { get: (name) => res.headers.get(name) },
      json: () => res.json() as Promise<unknown>,
      text: () => res.text()
    }
  }
}
