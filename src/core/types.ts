import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'

// ─── HTTP ─────────────────────────────────────────────────────────────────────

/** HTTP methods supported by Halifax routes. `'*'` matches any method (used for 405 fallbacks). */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | '*'

/** Framework-agnostic representation of an incoming HTTP request. */
export interface HttpRequest<TRaw = unknown> {
  method: string
  params: Record<string, string>
  query: Record<string, unknown>
  body: unknown
  headers: Record<string, string | string[] | undefined>
  /** The underlying raw request object from the HTTP framework (e.g. Express `Request`). */
  raw: TRaw
}

/** Framework-agnostic representation of an outgoing HTTP response. */
export interface HttpResponse<TRaw = unknown> {
  /**
   * Set the HTTP status code. Returns `this` for chaining.
   * @param code - HTTP status code to send (e.g. `200`, `404`).
   * @returns This response object for method chaining.
   */
  status(code: number): HttpResponse<TRaw>
  /**
   * Serialize `payload` as JSON and send it as the response body.
   * @param payload - Value to serialize and send.
   */
  json(payload: unknown): void | Promise<void>
  /**
   * Send a raw response body.
   * @param payload - Raw body to send.
   */
  send?(payload?: unknown): void | Promise<void>
  /**
   * Set a response header.
   * @param name - Header name (e.g. `'Content-Type'`).
   * @param value - Header value.
   */
  setHeader?(name: string, value: string): void
  /** The underlying raw response object from the HTTP framework (e.g. Express `Response`). */
  raw: TRaw
}

/** A route handler function compatible with Halifax's framework-agnostic request/response types. */
export type HttpRouteHandler = (req: HttpRequest, res: HttpResponse) => Promise<void> | void

/** Minimal interface an HTTP server adapter must implement for Halifax to register routes. */
export interface HttpServer {
  /**
   * Register a route handler for the given method and path.
   * @param method - HTTP method (or `'*'` for a catch-all fallback).
   * @param path - Route path pattern (e.g. `'/users/:id'`).
   * @param handler - Async handler function to invoke on matching requests.
   */
  registerRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void
  /**
   * Start listening on the given port and optional host.
   * @param port - TCP port number to bind to.
   * @param host - Hostname or IP address to bind to (defaults to all interfaces).
   */
  start(port: number, host?: string): Promise<void> | void
}

// ─── Repository ───────────────────────────────────────────────────────────────

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

// ─── CRUD / Resource ──────────────────────────────────────────────────────────

/** All CRUD action identifiers used for permissions and audit. */
export type CrudAction =
  | 'create'
  | 'readOne'
  | 'readMany'
  | 'readManyWithQueryBuilder'
  | 'updateOne'
  | 'updateMany'
  | 'upsertOne'
  | 'deleteOne'
  | 'deleteMany'

/** Per-action toggles controlling which CRUD endpoints are registered for a resource. */
export interface CrudPermissions {
  allowCreate?: boolean
  allowReadOne?: boolean
  allowReadMany?: boolean
  allowReadManyWithQueryBuilder?: boolean
  allowUpdateOne?: boolean
  allowUpdateMany?: boolean
  allowUpsertOne?: boolean
  allowDeleteOne?: boolean
  allowDeleteMany?: boolean
}

/** Minimal shape of a Prisma DMMF field — structurally compatible with `Prisma.DMMF.Field`. */
export interface ModelField {
  /** Column / property name. */
  name: string
  /** Prisma field kind: `'scalar'`, `'object'` (relation), `'enum'`, or `'unsupported'`. */
  kind: string
  /** True when this field is the model's primary key. */
  isId: boolean
  /** True for fields that are auto-managed by Prisma (e.g. relation FKs, read-only scalars). */
  isReadOnly: boolean
  /** True when Prisma provides a default value (e.g. `@default(autoincrement())`). */
  hasDefault: boolean
}

/** Minimal shape of a Prisma DMMF model — structurally compatible with `Prisma.DMMF.Model`. */
export interface ModelSchema {
  /** Prisma model name (PascalCase). */
  name?: string
  /** Underlying database table name, or `null` to use the model name. */
  dbName?: string | null
  fields: ModelField[]
}

/** Per-model overrides for {@link createPrismaResources}. */
export interface ModelResourceOptions {
  /** When true, this model is skipped entirely. */
  exclude?: boolean
  /**
   * Tenant isolation for this model. Set `{ field }` to scope on a specific column,
   * or `false` to opt this model out of an otherwise tenant-scoped API. When omitted,
   * the model is auto-scoped if the API's default tenant field exists on it.
   */
  tenant?: TenantResourceConfig | false
  /** Override the URL prefix (default: auto-derived kebab-plural of the model name). */
  routePrefix?: string
  /** Override the database table name. */
  tableName?: string
  /** Override the default CRUD permissions for this model. */
  permissions?: CrudPermissions
  /** Required permission strings per action for fine-grained access control. */
  requiredPermissions?: Partial<Record<CrudAction, string[]>>
  /** Default page size when the caller omits `?limit=`. */
  defaultLimit?: number
  /** Hard cap on page size. Requests above this are silently capped. */
  maxLimit?: number
  /** Maximum nesting depth for WHERE clause children (default: 3). */
  maxFilterDepth?: number
}

/** Describes a single column exposed through the Halifax API. */
export interface FieldDefinition {
  /** Column / property name. */
  name: string
  /** When `false`, the field cannot be used in `?field=` filters. */
  filterable?: boolean
  /** When `false`, the field cannot be used in `?order=` sorts. */
  sortable?: boolean
  /** When `false`, the field is excluded from `?fields=` projections. */
  selectable?: boolean
  /** When `false`, the field is stripped from POST/PATCH request bodies. */
  writable?: boolean
}

/**
 * Declares that a resource is tenant-scoped: every request is confined to rows whose
 * {@link TenantResourceConfig.field} equals the tenant value resolved for the caller.
 * Omit `tenant` (or set it to `false`) to expose a resource globally / unscoped.
 */
export interface TenantResourceConfig {
  /** Column / property on this model that stores the tenant key (e.g. `'companyId'`). */
  field: string
}

/** Describes a relation that callers may eagerly load via `?include=`. */
export interface RelationDefinition {
  /** Relation name as defined on the Prisma model. */
  name: string
  /** When `false`, this relation cannot be requested via `?include=`. */
  includable?: boolean
}

/** Full definition of a Halifax resource: its repository, field schema, routing, and permissions. */
export interface ResourceDefinition<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> {
  /** Human-readable resource name (usually the Prisma model name). */
  name: string
  /** URL path segment (e.g. `'users'`, `'blog-posts'`). */
  routePrefix: string
  /** Database table name used by the query builder. */
  tableName?: string
  /** Scalar field definitions — controls filtering, sorting, selection, and write access. */
  fields: FieldDefinition[]
  /** Relation definitions — controls `?include=` access. */
  relations?: RelationDefinition[]
  /**
   * Tenant isolation for this resource. When set (and a tenant resolver is configured
   * on the API), every read/write/bulk operation is constrained to the caller's tenant.
   * Set to `false` to explicitly opt a resource out of an otherwise tenant-scoped API.
   * When omitted, the resource is scoped only if the API's default tenant field exists
   * on this model (auto-detection); otherwise it is treated as global.
   */
  tenant?: TenantResourceConfig | false
  /** CRUD operation toggles. Defaults to {@link defaultCrudPermissions}. */
  permissions?: CrudPermissions
  /** The data adapter that handles reads and writes for this resource. */
  repository: Repository<TRecord, TCreate, TUpdate>
  /** Required permission strings per action (checked by the auth strategy). */
  requiredPermissions?: Partial<Record<CrudAction, string[]>>
  /** Default page size when the caller omits `?limit=`. No limit applied when `undefined`. */
  defaultLimit?: number
  /** Hard cap on page size. Requests over this are silently capped. No cap when `undefined`. */
  maxLimit?: number
  /** Maximum nesting depth for WHERE clause children. Defaults to 3. */
  maxFilterDepth?: number
}

/** Default permissions applied to every resource — all CRUD operations enabled. */
export const defaultCrudPermissions: Required<CrudPermissions> = {
  allowCreate: true,
  allowReadOne: true,
  allowReadMany: true,
  allowReadManyWithQueryBuilder: true,
  allowUpdateOne: true,
  allowUpdateMany: true,
  allowUpsertOne: true,
  allowDeleteOne: true,
  allowDeleteMany: true
}
