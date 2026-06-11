import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'

/** Flags indicating which optional repository operations the adapter supports. */
export interface RepositoryCapabilities {
  /** True when the adapter can execute raw SQL via the query builder. */
  supportsNativeSql: boolean
  /** True when the adapter supports `?include=` for eager-loading relations. */
  supportsIncludes: boolean
  /** True when the adapter can participate in database transactions. */
  supportsTransactions: boolean
  /** True when `createMany` returns the created records rather than an empty array. */
  supportsCreateManyReturn: boolean
  /** True when the adapter accepts a NoSQL-style query AST (non-SQL ORMs). */
  supportsNoSqlQueryAst: boolean
}

/** Options for paginated, filtered, and sorted list queries. */
export interface ListOptions {
  /** Columns to return. Returns all columns when omitted. */
  fields?: string[] | undefined
  /** Key–value pairs applied as equality filters (or `{ in: [...] }` for multi-value). */
  where?: Record<string, unknown>
  /** Maximum number of records to return. */
  limit?: number | undefined
  /** Number of records to skip for pagination. */
  offset?: number | undefined
  /** Sort expressions. Each entry specifies a field name and direction. */
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }> | undefined
  /** Relation names to eager-load. */
  include?: string[] | undefined
}

/** Paginated result envelope returned by `getMany`. */
export interface ListResult<TRecord> {
  /** Total number of matching records (before pagination). */
  count: number
  /** Records for the current page. */
  results: TRecord[]
}

/** Result envelope returned by `deleteMany`. */
export interface DeleteManyResult {
  /** IDs (or records) of the deleted rows. */
  deleted: unknown[]
}

/** Result envelope returned by `updateMany`. */
export interface UpdateManyResult<TRecord> {
  /** IDs of the updated rows. */
  updated: unknown[]
  /** Updated records, when the adapter supports returning them. */
  results?: TRecord[]
}

/** Result envelope returned by `executeQueryBuilder`. */
export interface NativeQueryResult<TRecord> {
  /** Total number of matching records (before pagination). */
  count?: number
  /** Records for the current page. */
  results: TRecord[]
}

/** Options passed to `createOne` / `createMany` for idempotent writes. */
export interface CreateOptions {
  /** An idempotency key — the adapter may de-duplicate requests with the same key. */
  idempotencyKey?: string
}

/** Core data-access contract that every Halifax repository adapter must satisfy. */
export interface Repository<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> {
  /** Optional capability flags used by Halifax to decide which routes to activate. */
  readonly capabilities?: Partial<RepositoryCapabilities>
  /**
   * Fetch a single record by its primary key.
   * @param id - Primary key value (integer or UUID string).
   * @param options - Optional field projection and relation includes.
   * @returns The matching record, or `null` when not found.
   */
  getOne(
    id: string | number,
    options?: Pick<ListOptions, 'fields' | 'include'>
  ): Promise<TRecord | null>
  /**
   * Fetch a paginated, filtered list of records.
   * @param options - Pagination, filtering, sorting, and projection options.
   * @returns A count-and-results envelope for the current page.
   */
  getMany(options?: ListOptions): Promise<ListResult<TRecord>>
  /**
   * Insert a single record and return it.
   * @param data - Record fields to insert.
   * @param options - Optional idempotency key.
   * @returns The newly created record.
   */
  createOne(data: TCreate, options?: CreateOptions): Promise<TRecord>
  /**
   * Insert multiple records. Returns created records when the adapter supports it.
   * @param data - Array of record field objects to insert.
   * @param options - Optional idempotency key.
   * @returns The created records, or an empty array when the adapter uses bulk insert.
   */
  createMany(data: TCreate[], options?: CreateOptions): Promise<TRecord[]>
  /**
   * Update a single record by its primary key.
   * @param id - Primary key of the record to update.
   * @param data - Fields to update.
   * @returns The updated record, or `null` when not found.
   */
  updateOne(id: string | number, data: TUpdate): Promise<TRecord | null>
  /**
   * Update multiple records matching the query.
   * @param query - Query AST describing which rows to update.
   * @param data - Fields to apply to all matching rows.
   * @returns IDs of the updated rows (and optionally the updated records).
   */
  updateMany?(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>>
  /**
   * Insert or update a single record by its primary key.
   * @param id - Primary key to match for the update, or use for the insert.
   * @param data - Fields to create or update.
   * @returns The created or updated record.
   */
  upsertOne?(id: string | number, data: TCreate & TUpdate): Promise<TRecord>
  /**
   * Delete a single record by its primary key.
   * @param id - Primary key of the record to delete.
   * @returns `true` when deleted, `false` when not found.
   */
  deleteOne(id: string | number): Promise<boolean>
  /**
   * Delete multiple records matching the query.
   * @param query - Query AST describing which rows to delete.
   * @returns IDs of the deleted rows.
   */
  deleteMany?(query: IQueryOptions): Promise<DeleteManyResult>
  /**
   * Execute a raw query-builder AST against the underlying data source.
   * @param query - Full query AST including table name, filters, pagination, and sort.
   * @returns A count-and-results envelope for the matching rows.
   */
  executeQueryBuilder?(query: IQueryOptions): Promise<NativeQueryResult<TRecord>>
}
