import type {
  IQueryOptions,
  ListResult,
  QueryResult,
  UpdateManyResult,
  DeleteManyResult
} from '@edium/halifax-types'

export type { ListResult, QueryResult, UpdateManyResult, DeleteManyResult }

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
  /** Prisma scalar type name (e.g. `'String'`, `'Int'`, `'Boolean'`, `'DateTime'`). Used for OpenAPI type inference. */
  type?: string
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

/**
 * OpenAPI-compatible scalar type for a field. Used for spec generation only — has no effect
 * on runtime behaviour. Auto-populated by `PrismaAdapter`; set manually for custom repositories.
 */
export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'object'

/**
 * Describes a single column exposed through the Halifax API.
 *
 * Every flag is **permissive by default** — only set one to `false` to restrict a field.
 * A field with just `{ name }` is filterable, sortable, selectable, and writable. The lone
 * exception is the primary key, which is non-writable by default (it comes from the URL / DB);
 * set `writable: true` on it explicitly if you really want clients to supply it.
 */
export interface FieldDefinition {
  /** Column / property name. */
  name: string
  /** When `false`, the field cannot be used in `?field=` filters. Defaults to `true`. */
  filterable?: boolean
  /** When `false`, the field cannot be used in `?order=` sorts. Defaults to `true`. */
  sortable?: boolean
  /** When `false`, the field is excluded from `?fields=` projections. Defaults to `true`. */
  selectable?: boolean
  /** When `false`, the field is stripped from POST/PATCH/PUT bodies. Defaults to `true` (except the primary key). */
  writable?: boolean
  /** OpenAPI scalar type. Auto-populated from Prisma DMMF; set manually for non-Prisma fields. Defaults to `'string'`. */
  type?: FieldType
  /** OpenAPI format modifier (e.g. `'date-time'`, `'int64'`, `'binary'`). Auto-populated from Prisma DMMF. */
  format?: string
  /**
   * Roles or permissions required to **read** this field. Any single match grants access.
   * When absent or empty, any authenticated caller can read the field (no restriction).
   * Values are matched against `AuthContext.roles` and `AuthContext.permissions`.
   */
  readRoles?: string[]
  /**
   * Roles or permissions required to **write** this field. Any single match grants access.
   * Fields the caller cannot write are silently dropped from POST/PATCH/PUT bodies
   * (consistent with how `writable: false` behaves). When absent or empty, any caller
   * with general write access can write this field.
   * Values are matched against `AuthContext.roles` and `AuthContext.permissions`.
   */
  writeRoles?: string[]
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
  /**
   * URL path segment (e.g. `'users'`, `'blog-posts'`). The only required field — it defines
   * the resource's public route, which has no safe default.
   */
  routePrefix: string
  /** The data adapter that handles reads and writes for this resource. */
  repository: Repository<TRecord, TCreate, TUpdate>
  /**
   * Human-readable resource name (used in error messages and the cache-key namespace).
   * Optional — defaults to a title-cased form of {@link routePrefix} (`'blog-posts'` → `'Blog Posts'`).
   */
  name?: string
  /**
   * Scalar field definitions — control filtering, sorting, selection, and write access.
   *
   * Optional when the {@link repository} exposes its own field schema (e.g. a `PrismaAdapter`
   * built with a `model`, or anything from `createPrismaResources`): in that case the
   * repository's fields are the base, and any entries here are merged over them **by name** as
   * sparse overrides — so you list only the fields you want to change. When the repository
   * exposes no schema, this is the authoritative allow-list and is required.
   */
  fields?: FieldDefinition[]
  /**
   * Relation definitions — control `?include=` access. Merged over the repository's relation
   * schema by name when the repository exposes one; otherwise the authoritative list.
   */
  relations?: RelationDefinition[]
  /**
   * Tenant isolation for this resource. When set (and a tenant resolver is configured
   * on the API), every read/write/bulk operation is constrained to the caller's tenant.
   * Set to `false` to explicitly opt a resource out of an otherwise tenant-scoped API.
   * When omitted, the resource is scoped only if the API's default tenant field exists
   * on this model (auto-detection); otherwise it is treated as global.
   */
  tenant?: TenantResourceConfig | false
  /**
   * CRUD operation toggles. Merged over {@link defaultCrudPermissions}, which enables every
   * action — so you only list the actions you want to **disable** (e.g. `{ allowDeleteMany: false }`).
   */
  permissions?: CrudPermissions
  /** Required permission strings per action (checked by the auth strategy). */
  requiredPermissions?: Partial<Record<CrudAction, string[]>>
  /**
   * Default page size when the caller omits `?limit=`. Defaults to {@link DEFAULT_PAGE_LIMIT}
   * (5000). Set to `0` to apply no default limit (return all rows when `?limit=` is omitted).
   */
  defaultLimit?: number
  /**
   * Hard cap on page size; larger requests are silently capped (the response `count` still
   * reflects the true total). Defaults to {@link MAX_PAGE_LIMIT} (5000). Set to `0` to remove
   * the cap entirely — combine `defaultLimit: 0` and `maxLimit: 0` to disable pagination.
   */
  maxLimit?: number
  /** Maximum nesting depth for WHERE clause children. Defaults to 3. */
  maxFilterDepth?: number
  /**
   * Read-through caching for this resource. When set, the router caches
   * `getOne`/`getMany`/query reads and invalidates them on any write to this resource.
   * Overrides the API-wide default. Omit to inherit the API default (if any); set to
   * `false` to explicitly disable caching for this resource even when a default is configured.
   */
  cache?: ResourceCacheConfig | false
  /**
   * Wrap every success response body for this resource under a single key
   * (e.g. `'data'` →
   * `{ "data": <body> }`). Applies uniformly to all success payloads — list
   * (`{ data: { count, results } }`), single object, create/update/upsert, and the
   * `{ deleted: true }` confirmation. Error responses are never enveloped.
   * Overrides the API-wide {@link CrudApiOptions.envelope}. Omit (or set `null`/`''`) for
   * a bare body — the default, and backward compatible.
   */
  envelope?: string | null
}

/** Per-resource read-through cache configuration. */
export interface ResourceCacheConfig {
  /** Time-to-live for cached reads, in seconds. `0` means **never expire** (cache forever). */
  ttlSeconds: number
}

/**
 * Default page size applied when a resource sets no `defaultLimit` and the caller omits
 * `?limit=`. Chosen as a generous safety ceiling — large enough for typical "show everything"
 * UIs, small enough to prevent a runaway full-table scan. `getMany` always returns the true
 * total `count`, so a page is never a silent drop; a resource can set `defaultLimit: 0` to
 * return all rows by default.
 */
export const DEFAULT_PAGE_LIMIT = 5000

/**
 * Default hard cap on page size applied when a resource sets no `maxLimit`. A resource can set
 * `maxLimit: 0` to remove the cap entirely (no pagination).
 */
export const MAX_PAGE_LIMIT = 5000

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
