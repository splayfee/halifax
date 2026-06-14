/**
 * Halifax Client — HTTP transport examples
 *
 * Demonstrates every built-in transport and a custom transport pattern.
 * The rest of the Halifax API (resource methods, QueryBuilder, TanStack Query
 * integration) is identical regardless of which transport you choose.
 *
 * Installs (choose the library you already use):
 *   pnpm add @edium/halifax-client
 *   pnpm add axios          # AxiosTransport
 *   pnpm add ky             # KyTransport
 *   pnpm add ofetch         # OfetchTransport (Nuxt / UnJS)
 *   pnpm add superagent     # SuperagentTransport
 */

import {
  HalifaxClient,
  FetchTransport,
  AxiosTransport,
  KyTransport,
  OfetchTransport,
  SuperagentTransport,
  QueryBuilder,
  SqlComparison
} from '@edium/halifax-client'
import type { HttpTransport, TransportRequest, TransportResponse } from '@edium/halifax-client'

interface User {
  id: number
  name: string
  email: string
  status: 'active' | 'inactive'
}

// ─── 1. Fetch (default) ───────────────────────────────────────────────────────
//
// When no `transport` option is provided, HalifaxClient uses FetchTransport
// backed by globalThis.fetch (available natively in browsers and Node 18+).

export const fetchClient = new HalifaxClient({
  baseUrl: 'https://api.example.com'
})

// ─── 2. Fetch — custom function (timeout, node-fetch, etc.) ──────────────────

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// Shorthand: still builds FetchTransport internally
export const fetchTimeoutClient = new HalifaxClient({
  baseUrl: 'https://api.example.com',
  fetch: fetchWithTimeout
})

// Explicit — identical result
export const fetchTransportClient = new HalifaxClient({
  baseUrl: 'https://api.example.com',
  transport: new FetchTransport(fetchWithTimeout)
})

// ─── 3. Axios ─────────────────────────────────────────────────────────────────
//
// AxiosTransport accepts any object satisfying the AxiosLike interface, so it
// works with `axios`, `axios.create()`, and redaxios (same API surface).
//
// IMPORTANT: do NOT set `baseURL` on the Axios instance — HalifaxClient builds
// full absolute URLs and passes them to the transport.

import axios from 'axios'

const axiosInstance = axios.create({ timeout: 10_000, withCredentials: true })

axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

axiosInstance.interceptors.response.use(undefined, async (err) => {
  if (err.response?.status === 503 && !err.config._retried) {
    err.config._retried = true
    return axiosInstance.request(err.config)
  }
  return Promise.reject(err)
})

export const axiosClient = new HalifaxClient({
  baseUrl: 'https://api.example.com',
  transport: new AxiosTransport(axiosInstance)
})

// redaxios has the same API as axios — AxiosTransport covers it without changes:
//   import redaxios from 'redaxios'
//   transport: new AxiosTransport(redaxios.create({ ... }))

// ─── 4. ky ───────────────────────────────────────────────────────────────────
//
// ky is a small, modern Fetch wrapper with a great hooks API for auth and retry.
//
// IMPORTANT: do NOT set `prefixUrl` on the ky instance — HalifaxClient passes
// full absolute URLs; ky's prefixUrl would conflict.

import ky from 'ky'

const kyInstance = ky.create({
  retry: { limit: 2, methods: ['get'] },
  hooks: {
    beforeRequest: [
      (request) => {
        const token = localStorage.getItem('token')
        if (token) request.headers.set('Authorization', `Bearer ${token}`)
      }
    ],
    afterResponse: [
      async (_request, _options, response) => {
        if (response.status === 401) {
          await refreshToken()
          // ky will automatically retry with the new token on the next hook run
        }
      }
    ]
  }
})

export const kyClient = new HalifaxClient({
  baseUrl: 'https://api.example.com',
  transport: new KyTransport(kyInstance)
})

// ─── 5. ofetch ───────────────────────────────────────────────────────────────
//
// ofetch is the standard fetch utility in the Nuxt / UnJS ecosystem and is
// used internally by @vueuse/integrations. In a Nuxt app, use the global
// $fetch directly rather than importing ofetch.

import { ofetch } from 'ofetch'

const $api = ofetch.create({
  onRequest({ options }) {
    // Merge in the latest auth header before each request
    const token = localStorage.getItem('token')
    if (token) {
      options.headers = { ...options.headers, Authorization: `Bearer ${token}` }
    }
  },
  onResponseError({ response }) {
    if (response.status === 401) {
      window.location.href = '/login'
    }
  }
})

export const ofetchClient = new HalifaxClient({
  baseUrl: 'https://api.example.com',
  transport: new OfetchTransport($api)
})

// In a Nuxt plugin (plugins/halifax.ts):
//
//   export default defineNuxtPlugin(() => {
//     const client = new HalifaxClient({
//       baseUrl: useRuntimeConfig().public.apiBase,
//       transport: new OfetchTransport($fetch)   // ← Nuxt's built-in $fetch
//     })
//     return { provide: { api: client } }
//   })
//
//   // In a composable:
//   const { $api } = useNuxtApp()
//   const users = $api.resource<User>('users')

// ─── 6. superagent ───────────────────────────────────────────────────────────
//
// superagent works in both browser and Node.js. Pass `.agent()` to persist
// cookies across requests (useful for session-based auth).

import superagent from 'superagent'

// Plain usage
export const superagentClient = new HalifaxClient({
  baseUrl: 'https://api.example.com',
  transport: new SuperagentTransport(superagent)
})

// Session — cookies persist across all requests made through this client
const session = superagent.agent()
export const superagentSessionClient = new HalifaxClient({
  baseUrl: 'https://api.example.com',
  transport: new SuperagentTransport(session)
})

// ─── 7. Custom transport ──────────────────────────────────────────────────────
//
// Implement HttpTransport to integrate any HTTP library, interceptor stack,
// or mock. One method: send(request) → Promise<TransportResponse>.

class MockTransport implements HttpTransport {
  private readonly fixtures = new Map<string, { status: number; body: unknown }>()

  mock(method: string, url: string, status: number, body: unknown): this {
    this.fixtures.set(`${method.toUpperCase()} ${url}`, { status, body })
    return this
  }

  async send(req: TransportRequest): Promise<TransportResponse> {
    const key = `${req.method.toUpperCase()} ${req.url}`
    const fixture = this.fixtures.get(key)
    if (!fixture) throw new Error(`MockTransport: no fixture for ${key}`)
    const { status, body } = fixture
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name) => (name === 'content-type' ? 'application/json' : null) },
      json: async () => body,
      text: async () => JSON.stringify(body)
    }
  }
}

// ─── 8. Usage — identical across all transports ───────────────────────────────

async function demo() {
  // All clients expose exactly the same typed API.
  const users = axiosClient.resource<User>('users')

  const list   = await users.getMany({ limit: 10, status: 'active' })
  const single = await users.getOne(1)
  const created = await users.createOne({ name: 'Alice', email: 'alice@example.com', status: 'active' })
  await users.updateOne(1, { status: 'inactive' })
  await users.deleteOne(1)

  const results = await users.query(
    new QueryBuilder()
      .where('status', SqlComparison.Equal, 'active')
      .and('name', SqlComparison.StartsWith, 'A')
      .limit(5)
  )

  console.log(list, single, created, results)
}

// ─── 9. Unit test with MockTransport ─────────────────────────────────────────

async function testWithMock() {
  const mock = new MockTransport()
    .mock('GET', 'https://api.test/users/42', 200, {
      id: 42, name: 'Bob', email: 'bob@test.com', status: 'active'
    })
    .mock('DELETE', 'https://api.test/users/42', 200, { deleted: true })

  const testClient = new HalifaxClient({ baseUrl: 'https://api.test', transport: mock })
  const testUsers  = testClient.resource<User>('users')

  const user = await testUsers.getOne(42)
  console.assert(user.name === 'Bob')

  const result = await testUsers.deleteOne(42)
  console.assert(result.deleted === true)
}

void demo()
void testWithMock()

// Stub — replace with real implementation
function refreshToken() { return Promise.resolve() }
