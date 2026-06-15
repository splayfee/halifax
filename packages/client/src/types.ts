export type {
  ListResult,
  QueryResult,
  UpdateManyResult,
  DeleteManyResult
} from '@edium/halifax-types'

/**
 * Query parameters for GET list requests. Known keys are typed; any additional
 * key is treated as a field equality filter (e.g. `{ status: 'active' }`).
 */
export interface ListParams {
  /** Comma-separated field names to project — mutually exclusive with `include`. */
  fields?: string[]
  /** Relation names to eager-load — mutually exclusive with `fields`. */
  include?: string[]
  /** Max records to return. */
  limit?: number
  /** Records to skip (pagination). */
  offset?: number
  /**
   * Sort expressions. Prefix with `-` for descending: `['name', '-createdAt']`.
   * A single string is accepted for convenience.
   */
  order?: string | string[]
  /** Field equality filters passed as additional keys, e.g. `{ status: 'active' }`. */
  [key: string]: unknown
}

/** Options accepted only by getOne (no limit/offset/order). */
export type GetOneParams = Pick<ListParams, 'fields' | 'include'>

/** Options passed to HalifaxClient constructor. */
export interface HalifaxClientOptions {
  /** Base URL of your Halifax API, e.g. `'https://api.example.com'`. */
  baseUrl: string
  /**
   * HTTP transport to use for every request.
   *
   * Defaults to `new FetchTransport()` (browser/Node 18+ native fetch).
   * Swap in `new AxiosTransport(axiosInstance)` or any custom `HttpTransport`
   * implementation to change the underlying HTTP library.
   *
   * `transport` takes precedence over `fetch` when both are supplied.
   */
  transport?: import('@/transport/HttpTransport.js').HttpTransport
  /**
   * Convenience shorthand to customise the underlying `fetch` function without
   * constructing a `FetchTransport` explicitly. Ignored when `transport` is set.
   *
   * Useful for adding a timeout, using `node-fetch`, or mocking in tests:
   * ```ts
   * new HalifaxClient({ baseUrl, fetch: myFetchWithTimeout })
   * // equivalent to:
   * new HalifaxClient({ baseUrl, transport: new FetchTransport(myFetchWithTimeout) })
   * ```
   */
  fetch?: typeof globalThis.fetch
  /**
   * Static headers or a function that returns headers (useful for auth tokens).
   * Called before every request, so dynamic tokens are always fresh.
   * These are merged on top of the defaults (`Accept`, `Content-Type`).
   */
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>)
  /**
   * When your Halifax server uses `envelope` (e.g. `'data'`), the client
   * automatically unwraps `{ data: <body> }` from every response.
   */
  envelope?: string
  /**
   * Override the query-builder POST path segment (default: `'query'`).
   * Must match `CrudApiOptions.queryBuilderPath` on the server.
   */
  queryBuilderPath?: string
}
