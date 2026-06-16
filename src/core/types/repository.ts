import type {
  IQueryOptions,
  ListResult,
  QueryResult,
  UpdateManyResult,
  DeleteManyResult
} from '@edium/halifax-types'
import type { FieldDefinition, RelationDefinition } from './field.js'

export type { ListResult, QueryResult, UpdateManyResult, DeleteManyResult }

/** Flags indicating which optional repository operations the adapter supports. */
export interface RepositoryCapabilities {
  /**
   * True when the adapter can eager-load relations via `?include=`. When `false`, the router
   * rejects any `?include=` request with 422 instead of silently ignoring it.
   */
  supportsIncludes: boolean
  /** True when `createMany` returns the created records rather than an empty array. */
  supportsCreateManyReturn: boolean
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

/**
 * A resolved tenant constraint for a single request: the column to scope on and
 * the value the current caller is allowed to see. Produced by the router from
 * {@link TenantResourceConfig} (the field) and the tenant resolver (the value),
 * then handed to {@link Repository.withScope}.
 */
export interface TenantScope {
  /** Column / property on the model that stores the tenant key (e.g. `'companyId'`). */
  field: string
  /** The tenant key the caller is bound to (e.g. their company id). */
  value: unknown
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
   * Field schema the adapter knows about (e.g. derived from a Prisma model). When present,
   * a {@link ResourceDefinition} may omit `fields` entirely (these are used as the base) or
   * supply a sparse subset that is merged over these as per-field overrides.
   */
  readonly fields?: FieldDefinition[]
  /** Relation schema the adapter knows about — used as the base for `?include=` access. */
  readonly relations?: RelationDefinition[]
  /** Primary-key field name (default `'id'`). The router protects this field from write bodies. */
  readonly idField?: string
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
   * @returns The newly created record.
   */
  createOne(data: TCreate): Promise<TRecord>
  /**
   * Insert multiple records. Returns created records when the adapter supports it.
   * @param data - Array of record field objects to insert.
   * @returns The created records, or an empty array when the adapter uses bulk insert.
   */
  createMany(data: TCreate[]): Promise<TRecord[]>
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
  executeQuery?(query: IQueryOptions): Promise<QueryResult<TRecord>>
  /**
   * Return a request-scoped clone of this repository that transparently constrains
   * **every** operation to the given {@link TenantScope}. Reads are filtered by the
   * scope, writes are stamped with it, and bulk SQL operations have the scope AND-ed
   * into their WHERE clause so callers can never reach another tenant's rows.
   *
   * Adapters that cannot enforce scoping safely should leave this undefined — the
   * router treats a tenant-scoped resource whose repository lacks `withScope` as a
   * fatal misconfiguration (fail-closed) rather than serving it unscoped.
   *
   * @param scope - The resolved tenant constraint for the current request.
   * @returns A new repository instance bound to `scope` (the original is unchanged).
   */
  withScope?(scope: TenantScope): Repository<TRecord, TCreate, TUpdate>
}
