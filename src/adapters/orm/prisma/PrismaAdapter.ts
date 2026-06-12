import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import { ServerError } from '@/errors/ServerError.js'
import type { IQueryFilter, QueryScalar } from '@/interfaces/IQueryFilter.js'
import { astToPrismaWhere, astToPrismaOrderBy } from './astToPrisma.js'

/** Returns true for Prisma's P2025 "record not found" error. */
function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Record<string, unknown>).code === 'P2025'
  )
}
import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'
import type {
  Repository,
  RepositoryCapabilities,
  DeleteManyResult,
  ListOptions,
  ListResult,
  QueryResult,
  TenantScope,
  UpdateManyResult
} from '@/core/types.js'
import type { FieldDefinition, RelationDefinition, ModelSchema } from '@/core/types.js'
import type { PrismaDelegate, PrismaAdapterOptions } from './types.js'
import { toSelect, toInclude, toOrderBy } from './helpers.js'

/**
 * PrismaAdapter is a generic repository implementation that uses Prisma delegates to perform
 * database operations. It handles CRUD plus the query-builder/bulk paths by compiling the
 * query AST to portable Prisma Client calls (no raw SQL), so it works on every Prisma
 * provider. It also extracts field and relation definitions from a provided model schema.
 */
export class PrismaAdapter<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> implements Repository<TRecord, TCreate, TUpdate> {
  /** Private properties to hold the Prisma delegate and configuration options. */
  private readonly delegate: PrismaDelegate
  /** The field name used for the primary key in the model. */
  public readonly idField: string
  /** A flag indicating whether to return created records. */
  private readonly returnCreated: boolean
  /** The original construction options, used to build request-scoped clones. */
  private readonly options: PrismaAdapterOptions
  /** Tenant constraint bound to this instance, or `undefined` for unscoped access. */
  private readonly scope?: TenantScope | undefined

  /** A set of capabilities that the repository supports. */
  public readonly capabilities: RepositoryCapabilities
  /** An array of field definitions for the model (present when built with a `model`). */
  public readonly fields?: FieldDefinition[]
  /** An array of relation definitions for the model (present when built with a `model`). */
  public readonly relations?: RelationDefinition[]

  /**
   * Constructs a new instance of PrismaAdapter with the provided options.
   * @param options - The Prisma delegate plus optional id field, return-created flag, and model schema.
   */
  public constructor(options: PrismaAdapterOptions) {
    this.options = options
    this.delegate = options.delegate
    this.idField = options.idField ?? 'id'
    this.returnCreated = options.returnCreated ?? false
    this.scope = options.scope

    this.capabilities = {
      supportsIncludes: true,
      supportsCreateManyReturn: this.returnCreated
    }

    if (options.model) {
      this.fields = PrismaAdapter.fieldsFromModel(options.model)
      this.relations = PrismaAdapter.relationsFromModel(options.model)
    }
  }

  /**
   * Returns a request-scoped clone of this adapter bound to `scope`. Every read is
   * filtered by the scope, every write is stamped with it, and every bulk/SQL operation
   * has the scope AND-ed into its WHERE clause. The original instance is never mutated.
   * @param scope - The resolved tenant constraint for the current request.
   * @returns A new {@link PrismaAdapter} that enforces `scope` on all operations.
   */
  public withScope(scope: TenantScope): PrismaAdapter<TRecord, TCreate, TUpdate> {
    return new PrismaAdapter<TRecord, TCreate, TUpdate>({ ...this.options, scope })
  }

  /**
   * Merges the bound tenant constraint into a Prisma `where` object. The scope is spread
   * last so it always wins over any caller-supplied value for the same key.
   * @param where - The caller-derived where clause (may be undefined).
   * @returns A where object with the tenant constraint applied, or `where` when unscoped.
   */
  private scopedWhere(where?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!this.scope) return where
    return { ...(where ?? {}), [this.scope.field]: this.scope.value }
  }

  /**
   * Removes the tenant field from a write payload so callers can never reassign a row
   * to another tenant via create/update/upsert bodies. No-op when unscoped.
   * @param data - The write payload to sanitise.
   * @returns A copy of `data` without the tenant field, or `data` when unscoped.
   */
  private stripTenant<T>(data: T): T {
    if (!this.scope) return data
    if (data === null || typeof data !== 'object') return data
    const copy = { ...(data as Record<string, unknown>) }
    delete copy[this.scope.field]
    return copy as T
  }

  /**
   * Stamps the bound tenant value onto a create payload, overriding any caller-supplied
   * value for the tenant field. No-op when unscoped.
   * @param data - The create payload.
   * @returns A copy of `data` with the tenant field forced to the scope value.
   */
  private stampTenant<T>(data: T): T {
    if (!this.scope) return data
    return { ...(data as Record<string, unknown>), [this.scope.field]: this.scope.value } as T
  }

  /**
   * AND-s the bound tenant constraint into a query-builder WHERE clause. The caller's filters
   * are nested as a child group beneath the tenant condition, so a caller-supplied `OR` can
   * never break out of the tenant boundary once the AST is compiled to a Prisma `where`.
   * @param where - The caller-supplied filter list (may be undefined/empty).
   * @returns A new filter list with the tenant condition enforced, or `where` when unscoped.
   */
  private scopedFilters(where?: IQueryFilter[]): IQueryFilter[] | undefined {
    if (!this.scope) return where
    const tenantNode: IQueryFilter = {
      field: this.scope.field,
      comparison: '=',
      value1: this.scope.value as QueryScalar
    }
    if (where?.length) {
      tenantNode.operator = 'AND'
      tenantNode.children = where
    }
    return [tenantNode]
  }

  /**
   * Resolves a query-builder AST for the tenant-scoped paths: applies the tenant constraint
   * via {@link PrismaAdapter.scopedFilters}. The `where` key is only set when defined (to
   * satisfy `exactOptionalPropertyTypes`).
   * @param query - The incoming query AST.
   * @returns A new AST with the tenant scope applied.
   */
  private resolveScopedQuery(query: IQueryOptions): IQueryOptions {
    const resolved: IQueryOptions = { ...query }
    const where = this.scopedFilters(query.where)
    if (where) resolved.where = where
    return resolved
  }

  /**
   * Extracts field definitions from a Prisma model schema.
   * @param model - The Prisma model schema.
   * @returns An array of field definitions.
   */
  public static fieldsFromModel(model: ModelSchema): FieldDefinition[] {
    return model.fields
      .filter((f) => f.kind !== 'object')
      .map((f) => ({
        name: f.name,
        filterable: true,
        sortable: true,
        writable: !f.isId && !f.isReadOnly
      }))
  }

  /**
   * Extracts relation definitions from a Prisma model schema.
   * @param model - The Prisma model schema.
   * @returns
   */
  public static relationsFromModel(model: ModelSchema): RelationDefinition[] {
    return model.fields
      .filter((f) => f.kind === 'object')
      .map((f) => ({ name: f.name, includable: true }))
  }

  /**
   * Retrieves a single record by its ID, with optional field selection and relation inclusion.
   * @param id - The ID of the record to retrieve.
   * @param options - Optional parameters for field selection and relation inclusion.
   * @returns A promise that resolves to the retrieved record or null if not found.
   * @throws ServerError if the Prisma delegate does not support the required methods.
   */
  public async getOne(
    id: string | number,
    options?: Pick<ListOptions, 'fields' | 'include'>
  ): Promise<TRecord | null> {
    const select = toSelect(options?.fields)
    const include = toInclude(options?.include)
    const args: Record<string, unknown> = { where: this.scopedWhere({ [this.idField]: id }) }
    if (select) args.select = select
    else if (include) args.include = include

    // When scoped, the WHERE carries a non-unique tenant predicate, so we must use
    // findFirst (findUnique only accepts unique fields). This is what enforces that a
    // row outside the caller's tenant reads back as "not found".
    if (this.scope) {
      if (this.delegate.findFirst) {
        return (await this.delegate.findFirst(args)) as TRecord | null
      }
      throw new ServerError(
        'Prisma delegate does not support findFirst (required for tenant scoping).'
      )
    }

    if (this.delegate.findUnique) {
      return (await this.delegate.findUnique(args)) as TRecord | null
    }

    if (this.delegate.findFirst) {
      return (await this.delegate.findFirst(args)) as TRecord | null
    }

    throw new ServerError('Prisma delegate does not support findUnique or findFirst.')
  }

  /**
   * Retrieves multiple records based on the provided query options, including filtering, sorting, pagination, and field selection.
   * @param options - An object containing query options such as filtering conditions, sorting, pagination, and field selection.
   * @returns A promise that resolves to an object containing the total count of matching records and an array of the retrieved records.
   * @throws ServerError if the Prisma delegate does not support the required methods.
   */
  public async getMany(options: ListOptions = {}): Promise<ListResult<TRecord>> {
    const select = toSelect(options.fields)
    const include = toInclude(options.include)
    const where = this.scopedWhere(options.where)
    const args: Record<string, unknown> = {
      where,
      orderBy: toOrderBy(options.orderBy),
      skip: options.offset,
      take: options.limit
    }
    if (select) args.select = select
    else if (include) args.include = include

    const [count, results] = await Promise.all([
      this.delegate.count({ where }),
      this.delegate.findMany(args)
    ])

    return { count, results: results as TRecord[] }
  }

  /**
   * Creates a new record in the database using the provided data.
   * @param data - An object containing the data for the new record to be created.
   * @returns A promise that resolves to the created record.
   * @throws ServerError if the Prisma delegate does not support the create method.
   */
  public async createOne(data: TCreate): Promise<TRecord> {
    return (await this.delegate.create({ data: this.stampTenant(data) })) as TRecord
  }

  /**
   * Creates multiple records in the database using the provided array of data objects.
   * If the Prisma delegate does not support createMany or if returnCreated is true, it falls back to creating records one by one and returns the created records. Otherwise, it uses createMany for better performance but does not return the created records.
   * @param data - An array of objects, each containing the data for a new record to be created.
   * @returns A promise that resolves to an array of the created records.
   * @throws ServerError if the Prisma delegate does not support the createMany method.
   */
  public async createMany(data: TCreate[]): Promise<TRecord[]> {
    if (!this.delegate.createMany || this.returnCreated) {
      return await Promise.all(data.map((item) => this.createOne(item)))
    }

    await this.delegate.createMany({ data: data.map((item) => this.stampTenant(item)) })
    return []
  }

  /**
   * Updates a single record identified by its ID with the provided data. If the record does not exist, it returns null.
   * @param id - The ID of the record to be updated.
   * @param data - An object containing the data to update the record with.
   * @returns A promise that resolves to the updated record or null if the record does not exist.
   * @throws ServerError if the Prisma delegate does not support the update method.
   */
  public async updateOne(id: string | number, data: TUpdate): Promise<TRecord | null> {
    // When scoped, confirm the row belongs to the caller's tenant before touching it,
    // and strip the tenant field from the payload so the row can't be moved tenants.
    if (this.scope) {
      if (!this.delegate.findFirst) {
        throw new ServerError(
          'Prisma delegate does not support findFirst (required for tenant scoping).'
        )
      }
      const owned = await this.delegate.findFirst({
        where: this.scopedWhere({ [this.idField]: id }),
        select: { [this.idField]: true }
      })
      if (!owned) return null
      data = this.stripTenant(data)
    }
    try {
      return (await this.delegate.update({ where: { [this.idField]: id }, data })) as TRecord
    } catch (error) {
      if (isNotFoundError(error)) return null
      throw error
    }
  }

  /**
   * Updates every record matching the query and returns the IDs of the affected rows.
   *
   * The query AST is compiled to a portable Prisma `where` (no raw SQL), so this works on
   * every Prisma provider. Because Prisma's `updateMany` only returns a count, the matching
   * IDs are selected first and then the bulk update is applied.
   *
   * **Note:** the SELECT and UPDATE are two separate statements without a transaction; under
   * concurrent writes the returned `updated` IDs may differ from the rows actually modified.
   *
   * @param query - Query AST describing which rows to update (filtered, tenant-scoped).
   * @param data - Fields to apply to all matching rows (the tenant field is stripped).
   * @returns The IDs of the updated rows.
   * @throws NotImplementedError when the delegate does not support `updateMany`.
   */
  public async updateMany(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>> {
    if (!this.delegate.updateMany) {
      throw new NotImplementedError('This repository does not support updateMany.')
    }
    const where = astToPrismaWhere(this.resolveScopedQuery(query).where)
    const rows = (await this.delegate.findMany({
      where,
      select: { [this.idField]: true }
    })) as Array<Record<string, unknown>>
    await this.delegate.updateMany({ where, data: this.stripTenant(data) })
    return { updated: rows.map((item) => item[this.idField]) }
  }

  /**
   * Upserts a single record identified by its ID with the provided data. If the record does not exist, it creates a new one.
   * If it exists, it updates the existing record. This method requires the Prisma delegate to support the upsert operation.
   * @param id - The ID of the record to be upserted.
   * @param data - An object containing the data to upsert the record with. This data will be used for both creating a new record if it does not exist and updating the existing record if it does exist.
   * @returns A promise that resolves to the upserted record, whether it was created or updated.
   * @throws NotImplementedError if the Prisma delegate does not support the upsert method.
   * @throws ServerError if the Prisma delegate does not support the required methods for upserting records.
   */
  public async upsertOne(id: string | number, data: TCreate & TUpdate): Promise<TRecord> {
    if (!this.delegate.upsert) {
      throw new NotImplementedError('Prisma delegate does not support upsert.')
    }

    // When scoped, an upsert keyed on a unique id could otherwise overwrite a row owned
    // by another tenant. Reject that case (hidden as "not found"), stamp the tenant on
    // create, and forbid reassigning the tenant on update.
    if (this.scope) {
      if (!this.delegate.findFirst) {
        throw new ServerError(
          'Prisma delegate does not support findFirst (required for tenant scoping).'
        )
      }
      const existing = (await this.delegate.findFirst({
        where: { [this.idField]: id }
      })) as Record<string, unknown> | null
      if (existing && existing[this.scope.field] !== this.scope.value) {
        throw new NotFoundError()
      }
      return (await this.delegate.upsert({
        where: { [this.idField]: id },
        create: this.stampTenant(data),
        update: this.stripTenant(data) as TUpdate
      })) as TRecord
    }

    return (await this.delegate.upsert({
      where: { [this.idField]: id },
      create: data,
      update: data as TUpdate
    })) as TRecord
  }

  /**
   * Deletes a single record identified by its ID. If the record does not exist, it returns false.
   * If the deletion is successful, it returns true. This method requires the Prisma delegate to support the delete operation.
   * @param id - The ID of the record to be deleted.
   * @returns A promise that resolves to true if the record was successfully deleted, or false if the record did not exist.
   * @throws NotImplementedError if the Prisma delegate does not support the delete method.
   * @throws ServerError if the Prisma delegate does not support the required methods for deleting records.
   */
  public async deleteOne(id: string | number): Promise<boolean> {
    // When scoped, delete through deleteMany with the tenant predicate so the ownership
    // check and the delete are a single atomic statement (no TOCTOU window). A row in
    // another tenant simply matches nothing and reports as "not found".
    if (this.scope) {
      if (this.delegate.deleteMany) {
        const result = await this.delegate.deleteMany({
          where: this.scopedWhere({ [this.idField]: id })
        })
        return (result?.count ?? 0) > 0
      }
      if (!this.delegate.findFirst) {
        throw new ServerError(
          'Prisma delegate does not support deleteMany or findFirst (required for tenant scoping).'
        )
      }
      const owned = await this.delegate.findFirst({
        where: this.scopedWhere({ [this.idField]: id }),
        select: { [this.idField]: true }
      })
      if (!owned) return false
    }
    try {
      await this.delegate.delete({ where: { [this.idField]: id } })
      return true
    } catch (error) {
      if (isNotFoundError(error)) return false
      throw error
    }
  }

  /**
   * Deletes multiple records that match the provided query options. This method requires a Prisma
   * client for executing raw SQL queries.
   *
   * **Note:** The SELECT and DELETE are issued as two separate queries without a transaction.
   * Under concurrent writes, rows inserted or deleted between the two queries may cause the
   * returned `deleted` IDs to differ from the rows actually removed.
   *
   * @param query - Query AST describing which rows to delete (filtered, tenant-scoped).
   * @returns The IDs of the deleted rows.
   * @throws NotImplementedError when the delegate does not support `deleteMany`.
   */
  public async deleteMany(query: IQueryOptions): Promise<DeleteManyResult> {
    if (!this.delegate.deleteMany) {
      throw new NotImplementedError('This repository does not support deleteMany.')
    }
    const where = astToPrismaWhere(this.resolveScopedQuery(query).where)
    const rows = (await this.delegate.findMany({
      where,
      select: { [this.idField]: true }
    })) as Array<Record<string, unknown>>
    await this.delegate.deleteMany({ where })
    return { deleted: rows.map((item) => item[this.idField]) }
  }

  /**
   * Executes a query-builder AST as a portable Prisma query: the WHERE tree is compiled to a
   * Prisma `where`, and field projection, ordering, pagination, and `distinct` are mapped to
   * `findMany` arguments. No raw SQL is generated, so the same query runs identically on every
   * Prisma provider (PostgreSQL, MySQL, SQLite, SQL Server, CockroachDB, MongoDB).
   *
   * Validation (field/comparison/depth checks → 4xx) happens in the router *before* this
   * method, so malformed queries never reach Prisma.
   *
   * **Note:** the COUNT and SELECT are two separate statements without a transaction; under
   * concurrent writes the returned `count` may differ from the number of rows in `results`.
   *
   * @param query - The validated query AST (filters, sort, pagination, projection, distinct).
   * @returns A count-and-results envelope for the matching rows.
   */
  public async executeQuery(query: IQueryOptions): Promise<QueryResult<TRecord>> {
    const resolved = this.resolveScopedQuery(query)
    const where = astToPrismaWhere(resolved.where)

    const args: Record<string, unknown> = { where }
    const select = toSelect(resolved.fields)
    if (select) args.select = select
    const orderBy = astToPrismaOrderBy(resolved.orderBy)
    if (orderBy) args.orderBy = orderBy
    if (resolved.limit !== undefined) args.take = resolved.limit
    if (resolved.offset !== undefined) args.skip = resolved.offset
    if (resolved.distinct?.length) args.distinct = resolved.distinct

    const [count, results] = await Promise.all([
      this.delegate.count({ where }),
      this.delegate.findMany(args)
    ])

    return { count, results: results as TRecord[] }
  }
}
