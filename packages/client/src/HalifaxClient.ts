import { HalifaxError } from '@/errors/HalifaxError.js'
import { ResourceClient } from '@/ResourceClient.js'
import type { HttpTransport } from '@/transport/HttpTransport.js'
import { FetchTransport } from '@/transport/FetchTransport.js'
import type { HalifaxClientOptions } from '@/types.js'

async function resolveHeaders(
  headers: HalifaxClientOptions['headers']
): Promise<Record<string, string>> {
  if (!headers) return {}
  return typeof headers === 'function' ? await headers() : headers
}

/**
 * The main entry point for the halifax browser client.
 *
 * Create one instance per API (or per tenant/auth context), then use
 * `.resource()` to get typed clients for each resource.
 *
 * ```ts
 * // Default (browser fetch)
 * const client = new HalifaxClient({ baseUrl: 'https://api.example.com' })
 *
 * // Axios
 * import { AxiosTransport } from '@edium/halifax-client'
 * const client = new HalifaxClient({
 *   baseUrl: 'https://api.example.com',
 *   transport: new AxiosTransport(axiosInstance)
 * })
 *
 * // Custom fetch with timeout
 * import { FetchTransport } from '@edium/halifax-client'
 * const client = new HalifaxClient({
 *   baseUrl: 'https://api.example.com',
 *   transport: new FetchTransport(fetchWithTimeout)
 * })
 * ```
 */
export class HalifaxClient {
  private readonly baseUrl: string
  private readonly headers: HalifaxClientOptions['headers']
  private readonly envelope: string | undefined
  private readonly queryBuilderPath: string
  private readonly transport: HttpTransport

  constructor(options: HalifaxClientOptions) {
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl
    this.headers = options.headers
    this.envelope = options.envelope
    this.queryBuilderPath = options.queryBuilderPath ?? 'query'
    // transport > explicit fetch > globalThis.fetch
    this.transport = options.transport ?? new FetchTransport(options.fetch)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const extraHeaders = await resolveHeaders(this.headers)

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...extraHeaders
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await this.transport.send({
      method,
      url: `${this.baseUrl}${path}`,
      headers,
      body
    })

    let payload: unknown
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      payload = await response.json()
    } else {
      payload = await response.text()
    }

    if (!response.ok) {
      const errors =
        payload &&
        typeof payload === 'object' &&
        'errors' in (payload as object) &&
        Array.isArray((payload as Record<string, unknown>)['errors'])
          ? ((payload as Record<string, unknown>)['errors'] as Array<{
              code: string
              message: string
              details?: unknown
            }>)
          : [{ code: 'UNKNOWN', message: `HTTP ${response.status}` }]
      throw new HalifaxError(response.status, errors)
    }

    if (
      this.envelope &&
      payload &&
      typeof payload === 'object' &&
      this.envelope in (payload as object)
    ) {
      return (payload as Record<string, unknown>)[this.envelope] as T
    }

    return payload as T
  }

  /**
   * Return a typed `ResourceClient` for the given route prefix.
   *
   * The type parameters mirror the server's repository generics:
   * - `TRecord`  — shape of a record as returned by GET endpoints
   * - `TCreate`  — shape of the POST body (defaults to `Partial<TRecord>`)
   * - `TUpdate`  — shape of the PATCH body (defaults to `Partial<TRecord>`)
   *
   * @example
   * interface User { id: number; name: string; email: string }
   * const users = client.resource<User, Omit<User, 'id'>, Partial<Omit<User, 'id'>>>('users')
   */
  resource<TRecord, TCreate = Partial<TRecord>, TUpdate = Partial<TRecord>>(
    prefix: string
  ): ResourceClient<TRecord, TCreate, TUpdate> {
    return new ResourceClient<TRecord, TCreate, TUpdate>(
      prefix,
      (method, path, body) => this.request(method, path, body),
      this.queryBuilderPath
    )
  }
}
