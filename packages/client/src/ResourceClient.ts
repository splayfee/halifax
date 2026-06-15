import { QueryBuilder } from '@/QueryBuilder'
import type {
  DeleteManyResult,
  GetOneParams,
  ListParams,
  ListResult,
  QueryResult,
  UpdateManyResult
} from '@/types'
import type { IQueryOptions } from '@edium/halifax-types'

/** Internal request function injected by HalifaxClient. */
export type RequestFn = <T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>
) => Promise<T>

type QueryInput = IQueryOptions | QueryBuilder

function resolveQuery(input: QueryInput): IQueryOptions {
  return input instanceof QueryBuilder ? input.build() : input
}

function buildSearchParams(params: ListParams): string {
  const entries: Array<[string, string]> = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      entries.push([key, value.join(',')])
    } else {
      entries.push([key, String(value)])
    }
  }
  if (!entries.length) return ''
  return '?' + new URLSearchParams(entries).toString()
}

/**
 * A typed client for a single Halifax resource (e.g. `/users`).
 *
 * Obtain one via `client.resource<User>('users')` — do not construct directly.
 *
 * @template TRecord  The shape of a full record returned by the server.
 * @template TCreate  The shape of a create payload (defaults to Partial<TRecord>).
 * @template TUpdate  The shape of an update payload (defaults to Partial<TRecord>).
 */
export class ResourceClient<TRecord, TCreate = Partial<TRecord>, TUpdate = Partial<TRecord>> {
  constructor(
    private readonly prefix: string,
    private readonly request: RequestFn,
    private readonly queryBuilderPath: string
  ) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  /** GET /resource/:id */
  getOne(id: string | number, params?: GetOneParams): Promise<TRecord> {
    const qs = params ? buildSearchParams(params as ListParams) : ''
    return this.request<TRecord>('GET', `/${this.prefix}/${id}${qs}`)
  }

  /** GET /resource — paginated list with optional field filters and projections. */
  getMany(params?: ListParams): Promise<ListResult<TRecord>> {
    const qs = params ? buildSearchParams(params) : ''
    return this.request<ListResult<TRecord>>('GET', `/${this.prefix}${qs}`)
  }

  /** POST /resource with a single object body → returns the created record. */
  createOne(data: TCreate): Promise<TRecord> {
    return this.request<TRecord>('POST', `/${this.prefix}`, data)
  }

  /** POST /resource with an array body → returns the created records. */
  createMany(data: TCreate[]): Promise<TRecord[]> {
    return this.request<TRecord[]>('POST', `/${this.prefix}`, data)
  }

  /** PATCH /resource/:id */
  updateOne(id: string | number, data: TUpdate): Promise<TRecord> {
    return this.request<TRecord>('PATCH', `/${this.prefix}/${id}`, data)
  }

  /**
   * PATCH /resource (bulk update).
   * Sends `{ ...queryAST, update: data }` — requires at least one WHERE filter.
   */
  updateMany(query: QueryInput, data: TUpdate): Promise<UpdateManyResult<TRecord>> {
    const body = { ...resolveQuery(query), update: data }
    return this.request<UpdateManyResult<TRecord>>('PATCH', `/${this.prefix}`, body)
  }

  /** PUT /resource/:id — insert or update. */
  upsertOne(id: string | number, data: TCreate & TUpdate): Promise<TRecord> {
    return this.request<TRecord>('PUT', `/${this.prefix}/${id}`, data)
  }

  /** DELETE /resource/:id */
  deleteOne(id: string | number): Promise<{ deleted: true }> {
    return this.request<{ deleted: true }>('DELETE', `/${this.prefix}/${id}`)
  }

  /**
   * DELETE /resource (bulk delete).
   * Sends the query AST as the request body — requires at least one WHERE filter.
   */
  deleteMany(query: QueryInput): Promise<DeleteManyResult> {
    return this.request<DeleteManyResult>('DELETE', `/${this.prefix}`, resolveQuery(query))
  }

  /**
   * POST /resource/query — execute a full AST query against the resource.
   * Accepts either a `QueryBuilder` instance or a raw `IQueryOptions` object.
   */
  query(query: QueryInput): Promise<QueryResult<TRecord>> {
    return this.request<QueryResult<TRecord>>(
      'POST',
      `/${this.prefix}/${this.queryBuilderPath}`,
      resolveQuery(query)
    )
  }

  // ─── TanStack Query helpers ───────────────────────────────────────────────

  /**
   * Stable query key for a `getMany` call. The full `[prefix, 'list', params]` key
   * ensures that `queryClient.invalidateQueries({ queryKey: [prefix] })` busts all
   * list AND detail caches for this resource at once.
   */
  listKey(params?: ListParams): readonly unknown[] {
    return [this.prefix, 'list', params ?? {}] as const
  }

  /**
   * Stable query key for a `getOne` call.
   */
  detailKey(id: string | number, params?: GetOneParams): readonly unknown[] {
    return [this.prefix, 'detail', id, params ?? {}] as const
  }

  /**
   * Stable query key for a `query` (AST) call.
   */
  queryKey(query: QueryInput): readonly unknown[] {
    return [this.prefix, 'query', resolveQuery(query)] as const
  }

  /**
   * Returns a TanStack Query-compatible options object for `getMany`.
   * Works with React Query, Vue Query, Solid Query, etc.
   *
   * @example
   * // React
   * const { data } = useQuery(users.getManyOptions({ limit: 20, status: 'active' }))
   *
   * // Vue
   * const { data } = useQuery(computed(() => users.getManyOptions({ limit: 20 })))
   */
  getManyOptions(params?: ListParams): {
    queryKey: readonly unknown[]
    queryFn: () => Promise<ListResult<TRecord>>
  } {
    return {
      queryKey: this.listKey(params),
      queryFn: () => this.getMany(params)
    }
  }

  /**
   * Returns a TanStack Query-compatible options object for `getOne`.
   *
   * @example
   * const { data } = useQuery(users.getOneOptions(userId))
   */
  getOneOptions(
    id: string | number,
    params?: GetOneParams
  ): {
    queryKey: readonly unknown[]
    queryFn: () => Promise<TRecord>
  } {
    return {
      queryKey: this.detailKey(id, params),
      queryFn: () => this.getOne(id, params)
    }
  }

  /**
   * Returns a TanStack Query-compatible options object for a `query` (AST) call.
   *
   * @example
   * const q = new QueryBuilder()
   *   .where('status', SqlComparison.Equal, 'active')
   *   .orderBy('name')
   *   .limit(10)
   *
   * const { data } = useQuery(users.queryOptions(q))
   */
  queryOptions(query: QueryInput): {
    queryKey: readonly unknown[]
    queryFn: () => Promise<QueryResult<TRecord>>
  } {
    const resolved = resolveQuery(query)
    return {
      queryKey: this.queryKey(resolved),
      queryFn: () => this.query(resolved)
    }
  }
}
