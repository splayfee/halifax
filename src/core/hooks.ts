import type { AuthContext } from '@/auth/AuthStrategy.js'
import type {
  HttpRequest,
  ListOptions,
  ListResult,
  QueryResult,
  UpdateManyResult,
  DeleteManyResult,
  ResourceDefinition
} from '@/core/types.js'
import type { IQueryOptions } from '@edium/halifax-types'

/** Synchronous or asynchronous return — hook functions may return either. */
export type MaybePromise<T> = T | Promise<T>

/**
 * Context object passed to every hook function. Provides the caller's resolved auth, the
 * normalized resource definition, and the raw HTTP request so hooks have access to headers,
 * IP addresses, and any properties set by upstream framework middleware.
 */
export interface HookContext {
  /** Resolved identity and permissions for the current caller. */
  auth: AuthContext
  /** The normalized resource being accessed (name, fields, routePrefix, etc.). */
  resource: ResourceDefinition
  /** The incoming HTTP request — access headers, the raw framework request, etc. */
  req: HttpRequest
}

/**
 * Lifecycle hooks for a single Halifax resource.
 *
 * Attach these under `ResourceDefinition.hooks` to inject custom logic before or after
 * any CRUD operation without writing a custom repository or HTTP middleware.
 *
 * **Before hooks** receive the incoming data and can:
 * - Return a **modified copy** to replace the payload going into the database.
 * - Return **`void` / `undefined`** to leave the data unchanged.
 * - **Throw** any error to abort the operation — Halifax catches it and sends the
 *   appropriate HTTP error response. Use Halifax's own error classes
 *   (`AuthorizationError`, `BadRequestError`, `UnprocessableEntityError`, …) for
 *   precise status codes.
 *
 * **After hooks** receive the outgoing result and can:
 * - Return a **modified copy** to replace what is sent to the client.
 * - Return **`void` / `undefined`** to leave the result unchanged.
 * - **Throw** to replace a successful DB result with an error response (rare but valid).
 *
 * After hooks run after the database write but **before** response field-filtering
 * (`readRoles` / `selectable`). The hook therefore sees every field the DB returned, not
 * just the fields the caller is allowed to read.
 *
 * Method syntax is intentional — TypeScript applies bivariant parameter checking to
 * interface methods, which allows a typed `CrudHooks<Post>` to be assigned to an
 * untyped `CrudHooks` (the generic defaults to `unknown`) without a cast.
 *
 * @template TRecord Shape of a full record returned by the server.
 * @template TCreate Shape of a create payload.
 * @template TUpdate Shape of an update payload.
 *
 * @example Stamp audit fields and emit events
 * ```ts
 * const posts: ResourceDefinition = {
 *   routePrefix: 'posts',
 *   repository: new PrismaAdapter({ delegate: prisma.post }),
 *   hooks: {
 *     beforeCreate: (data, { auth }) => ({ ...data, createdBy: auth.userId }),
 *     afterCreate:  async (result)   => { await events.emit('post.created', result) },
 *     beforeUpdateOne: (id, data, { auth }) => ({ ...data, updatedBy: auth.userId }),
 *   }
 * }
 * ```
 */
export interface CrudHooks<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> {
  // ─── Create ──────────────────────────────────────────────────────────────────

  /**
   * Fired once **per record** before it is inserted — for both single-object and array POST bodies.
   *
   * Return a modified payload to replace the incoming data, or `void` to use as-is.
   * Throw to abort the entire create operation.
   *
   * @example Stamp `createdBy` from the auth context:
   * ```ts
   * beforeCreate: (data, { auth }) => ({ ...data, createdBy: auth.userId })
   * ```
   */
  beforeCreate?(data: TCreate, ctx: HookContext): MaybePromise<TCreate | void>

  /**
   * Fired once **per record** after it is inserted — for both single and bulk POST.
   *
   * Return a modified record to replace what is sent to the client, or `void` to use as-is.
   * Readable-field filtering (`readRoles` / `selectable`) is applied after this hook.
   *
   * @example Emit a domain event:
   * ```ts
   * afterCreate: async (result, { resource }) => {
   *   await events.emit(`${resource.name}.created`, result)
   * }
   * ```
   */
  afterCreate?(result: TRecord, ctx: HookContext): MaybePromise<TRecord | void>

  // ─── Read ─────────────────────────────────────────────────────────────────────

  /**
   * Fired before a single record is fetched by ID (`GET /resource/:id`).
   *
   * Cannot modify the ID — use this for additional ownership/authorization checks or
   * audit logging. Throw to block the read.
   *
   * @example Block reads on records not owned by the caller:
   * ```ts
   * beforeReadOne: async (id, { auth }) => {
   *   const record = await db.find(id)
   *   if (record.ownerId !== auth.userId) throw new AuthorizationError()
   * }
   * ```
   */
  beforeReadOne?(id: string | number, ctx: HookContext): MaybePromise<void>

  /**
   * Fired after a single record is fetched.
   * Return a modified record or `void` to use as-is (e.g. attach computed / virtual fields).
   */
  afterReadOne?(result: TRecord, ctx: HookContext): MaybePromise<TRecord | void>

  /**
   * Fired before a paginated list query (`GET /resource`).
   *
   * Return modified `ListOptions` to adjust pagination, inject extra filters, or force a
   * sort — or `void` to leave the options unchanged.
   *
   * @example Restrict results to the caller's own records:
   * ```ts
   * beforeReadMany: (options, { auth }) => ({
   *   ...options,
   *   where: { ...options.where, ownerId: auth.userId }
   * })
   * ```
   */
  beforeReadMany?(options: ListOptions, ctx: HookContext): MaybePromise<ListOptions | void>

  /**
   * Fired after a list query.
   * Return a modified `ListResult` or `void` (e.g. annotate each record or replace `count`).
   */
  afterReadMany?(
    result: ListResult<TRecord>,
    ctx: HookContext
  ): MaybePromise<ListResult<TRecord> | void>

  // ─── Update ───────────────────────────────────────────────────────────────────

  /**
   * Fired before a single-record update (`PATCH /resource/:id`).
   * Return modified data or `void`. Throw to abort.
   *
   * @example Stamp `updatedBy` and `updatedAt`:
   * ```ts
   * beforeUpdateOne: (id, data, { auth }) => ({
   *   ...data,
   *   updatedBy: auth.userId,
   *   updatedAt: new Date().toISOString()
   * })
   * ```
   */
  beforeUpdateOne?(
    id: string | number,
    data: TUpdate,
    ctx: HookContext
  ): MaybePromise<TUpdate | void>

  /**
   * Fired after a single-record update.
   * Return a modified record or `void` to use as-is.
   */
  afterUpdateOne?(result: TRecord, ctx: HookContext): MaybePromise<TRecord | void>

  /**
   * Fired before a bulk update (`PATCH /resource` with a query body).
   *
   * Use for authorization checks or audit logging. Throw to abort.
   * The query and update data cannot be modified from this hook — throw if the operation
   * should be blocked, or use a custom repository wrapper for query rewriting.
   */
  beforeUpdateMany?(query: IQueryOptions, data: TUpdate, ctx: HookContext): MaybePromise<void>

  /**
   * Fired after a bulk update.
   * Return a modified `UpdateManyResult` or `void` to use as-is.
   */
  afterUpdateMany?(
    result: UpdateManyResult<TRecord>,
    ctx: HookContext
  ): MaybePromise<UpdateManyResult<TRecord> | void>

  // ─── Upsert ───────────────────────────────────────────────────────────────────

  /**
   * Fired before an upsert (`PUT /resource/:id`).
   * Return modified data or `void`. Throw to abort.
   */
  beforeUpsertOne?(
    id: string | number,
    data: TCreate & TUpdate,
    ctx: HookContext
  ): MaybePromise<(TCreate & TUpdate) | void>

  /**
   * Fired after an upsert.
   * Return a modified record or `void` to use as-is.
   */
  afterUpsertOne?(result: TRecord, ctx: HookContext): MaybePromise<TRecord | void>

  // ─── Delete ───────────────────────────────────────────────────────────────────

  /**
   * Fired before a single-record delete (`DELETE /resource/:id`).
   *
   * Use for cascades, soft-delete interceptors, or authorization checks. Throw to abort.
   * The record still exists in the database when this hook fires.
   */
  beforeDeleteOne?(id: string | number, ctx: HookContext): MaybePromise<void>

  /**
   * Fired after a single-record delete.
   * The record is already gone from the database. Use for cleanup, event emission, or audit.
   */
  afterDeleteOne?(id: string | number, ctx: HookContext): MaybePromise<void>

  /**
   * Fired before a bulk delete (`DELETE /resource` with a query body).
   * Use for authorization checks or audit logging. Throw to abort.
   */
  beforeDeleteMany?(query: IQueryOptions, ctx: HookContext): MaybePromise<void>

  /**
   * Fired after a bulk delete.
   * Return a modified `DeleteManyResult` or `void` to use as-is.
   */
  afterDeleteMany?(
    result: DeleteManyResult,
    ctx: HookContext
  ): MaybePromise<DeleteManyResult | void>

  // ─── Query builder ────────────────────────────────────────────────────────────

  /**
   * Fired before a query-builder execution (`POST /resource/query`).
   *
   * Return a modified `IQueryOptions` to augment or restrict the query (e.g. inject a
   * mandatory tenant filter that the client cannot remove), or `void` to use as-is.
   *
   * @example Inject a mandatory filter the client cannot remove:
   * ```ts
   * beforeQuery: (query, { auth }) => ({
   *   ...query,
   *   where: [
   *     ...(query.where ?? []),
   *     { field: 'tenantId', comparison: '=', value: auth.tenantId, operator: 'AND' }
   *   ]
   * })
   * ```
   */
  beforeQuery?(query: IQueryOptions, ctx: HookContext): MaybePromise<IQueryOptions | void>

  /**
   * Fired after a query-builder execution.
   * Return a modified `QueryResult` or `void` to use as-is.
   */
  afterQuery?(
    result: QueryResult<TRecord>,
    ctx: HookContext
  ): MaybePromise<QueryResult<TRecord> | void>
}
