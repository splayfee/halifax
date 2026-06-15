import type {
  HttpTransport,
  TransportRequest,
  TransportResponse
} from '@/transport/HttpTransport.js'

/**
 * Minimal structural interface for an ofetch instance.
 *
 * Defined here so `@edium/halifax-client` has **no hard dependency on ofetch**.
 * `$fetch` and `ofetch.create(...)` both satisfy this shape.
 */
export interface OfetchLike {
  raw(
    url: string,
    options?: {
      method?: string
      headers?: Record<string, string>
      body?: unknown
      ignoreResponseError?: boolean
    }
  ): Promise<{
    status: number
    ok: boolean
    headers: { get(name: string): string | null }
    /** Pre-parsed response body populated by ofetch before returning. */
    _data?: unknown
    text(): Promise<string>
  }>
}

/**
 * Transport backed by an ofetch instance — the standard HTTP client in the
 * Nuxt / UnJS ecosystem and recommended by VueUse integrations.
 *
 * Pass `$fetch` (Nuxt's global) or `ofetch.create(...)` for interceptors:
 *
 * ```ts
 * import { ofetch } from 'ofetch'
 * import { HalifaxClient, OfetchTransport } from '@edium/halifax-client'
 *
 * const $api = ofetch.create({
 *   onRequest({ options }) {
 *     options.headers = {
 *       ...options.headers,
 *       Authorization: `Bearer ${useAuth().token.value}`
 *     }
 *   },
 *   onResponseError({ response }) {
 *     if (response.status === 401) navigateTo('/login')
 *   }
 * })
 *
 * const client = new HalifaxClient({
 *   baseUrl: 'https://api.example.com',
 *   transport: new OfetchTransport($api)
 * })
 * ```
 *
 * In a Nuxt app, use the built-in `$fetch` directly:
 *
 * ```ts
 * // plugins/halifax.ts
 * export default defineNuxtPlugin(() => {
 *   const client = new HalifaxClient({
 *     baseUrl: useRuntimeConfig().public.apiBase,
 *     transport: new OfetchTransport($fetch)
 *   })
 *   return { provide: { api: client } }
 * })
 * ```
 */
export class OfetchTransport implements HttpTransport {
  constructor(private readonly $fetch: OfetchLike) {}

  async send(req: TransportRequest): Promise<TransportResponse> {
    const response = await this.$fetch.raw(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      // Let HalifaxClient inspect status and throw HalifaxError on its own.
      ignoreResponseError: true
    })

    // ofetch pre-parses the body into `_data` before resolving `.raw()`.
    // Re-using it avoids a second parse when HalifaxClient calls `json()`.
    const data = response._data

    return {
      status: response.status,
      ok: response.ok,
      headers: { get: (name) => response.headers.get(name) },
      json: async () => data,
      // Body stream is consumed by ofetch for `_data`; fall back gracefully.
      text: async () => {
        if (typeof data === 'string') return data
        try {
          return await response.text()
        } catch {
          return JSON.stringify(data)
        }
      }
    }
  }
}
