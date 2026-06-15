import type {
  HttpTransport,
  TransportRequest,
  TransportResponse
} from '@/transport/HttpTransport.js'

/**
 * A superagent request — thenable so it can be `await`-ed directly after chaining.
 */
export interface SuperagentRequest extends PromiseLike<SuperagentResponse> {
  set(headers: Record<string, string>): SuperagentRequest
  send(body?: unknown): SuperagentRequest
  /**
   * Controls when superagent considers a response successful.
   * Pass `() => true` to never throw, letting HalifaxClient handle all status codes.
   */
  ok(fn: () => boolean): SuperagentRequest
}

/** The resolved response from a superagent request. */
export interface SuperagentResponse {
  status: number
  ok: boolean
  /** Lowercase header map: `{ 'content-type': 'application/json', ... }` */
  headers: Record<string, string>
  /** Auto-parsed JSON body (populated when Content-Type is application/json). */
  body: unknown
  /** Raw response body as text. */
  text: string
}

/**
 * Minimal structural interface for a superagent instance.
 *
 * Defined here so `@edium/halifax-client` has **no hard dependency on superagent**.
 * Both the default export and a `superagent.agent()` session satisfy this shape.
 */
export interface SuperagentLike {
  (method: string, url: string): SuperagentRequest
}

/**
 * Transport backed by superagent — works in both browser and Node.js and is
 * one of the most widely used HTTP clients in the npm ecosystem.
 *
 * Pass the `superagent` default export or a `superagent.agent()` instance
 * (the agent variant persists cookies across requests):
 *
 * ```ts
 * import superagent from 'superagent'
 * import { HalifaxClient, SuperagentTransport } from '@edium/halifax-client'
 *
 * // Plain usage
 * const client = new HalifaxClient({
 *   baseUrl: 'https://api.example.com',
 *   transport: new SuperagentTransport(superagent)
 * })
 *
 * // Session with persistent cookies (e.g. session-based auth)
 * const agent = superagent.agent()
 * const client = new HalifaxClient({
 *   baseUrl: 'https://api.example.com',
 *   transport: new SuperagentTransport(agent)
 * })
 * ```
 */
export class SuperagentTransport implements HttpTransport {
  constructor(private readonly superagent: SuperagentLike) {}

  async send(req: TransportRequest): Promise<TransportResponse> {
    let request = this.superagent(req.method, req.url)
      .set(req.headers)
      // Never throw — HalifaxClient inspects status and throws HalifaxError itself.
      .ok(() => true)

    if (req.body !== undefined) {
      request = request.send(req.body)
    }

    const response = await request

    const headersObj = response.headers
    return {
      status: response.status,
      ok: response.ok,
      headers: { get: (name: string) => headersObj[name.toLowerCase()] ?? null },
      // superagent already parses JSON into `body`; use it directly.
      json: async () => response.body,
      text: async () => response.text
    }
  }
}
