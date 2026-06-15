/**
 * A minimal HTTP request description passed to a transport.
 * Body is the raw JS value — each transport is responsible for serialization.
 */
export interface TransportRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
}

/**
 * What every transport must return. Modelled after the browser Fetch `Response`
 * so `FetchTransport` is trivial, but kept minimal so adapters for Axios, ky,
 * node:http, etc. don't have to wrap anything they don't produce.
 */
export interface TransportResponse {
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
}

/**
 * The contract every HTTP transport must implement.
 *
 * Implement this interface to integrate any HTTP library with `HalifaxClient`:
 *
 * ```ts
 * class MyTransport implements HttpTransport {
 *   async send(req: TransportRequest): Promise<TransportResponse> { ... }
 * }
 *
 * const client = new HalifaxClient({ baseUrl: '...', transport: new MyTransport() })
 * ```
 */
export interface HttpTransport {
  send(request: TransportRequest): Promise<TransportResponse>
}
