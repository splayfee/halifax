import type { IQueryOptions } from '@edium/halifax-types'
import type {
  DeleteManyResult,
  FieldDefinition,
  ListOptions,
  ListResult,
  QueryResult,
  RelationDefinition,
  Repository,
  RepositoryCapabilities,
  TenantScope,
  UpdateManyResult
} from '@/core/types.js'
import type { PrismaAdapterOptions, PrismaDelegate } from './types.js'
import { ConflictError } from '@/errors/ConflictError.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { ServerError } from '@/errors/ServerError.js'
import { astToPrismaOrderBy, astToPrismaWhere } from './astToPrisma.js'
import { toInclude, toOrderBy, toSelect } from './helpers.js'
import { isNotFoundError, isDuplicateError } from './prismaUtils.js'
import { fieldsFromModel, relationsFromModel } from './prismaSchema.js'
import { scopedDeleteOne, scopedUpdateOne, scopedUpsertOne } from './prismaScopedWrites.js'
import { scopedWhere, stripTenant, stampTenant, resolveScopedQuery } from './tenantScoping.js'

/**
 * PrismaAdapter is a generic repository implementation that uses Prisma delegates to perform
 * database operations. It handles CRUD plus the query-builder/bulk paths by compiling the
 * query AST to portable Prisma Client calls (no raw SQL), so it works on every Prisma
 * provider. It also extracts field and relation definitions from a provided model schema.
 *
 * The intricate tenant-safe single-row write paths live in `./prismaScopedWrites.js`, and the
 * model-introspection helpers in `./prismaSchema.js`, so this class stays an orchestration layer.
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

  /** Derives {@link FieldDefinition}s from a Prisma model schema. @see fieldsFromModel */
  public static readonly fieldsFromModel = fieldsFromModel
  /** Derives {@link RelationDefinition}s from a Prisma model schema. @see relationsFromModel */
  public static readonly relationsFromModel = relationsFromModel

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
      this.fields = fieldsFromModel(options.model)
      this.relations = relationsFromModel(options.model)
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
    const args: Record<string, unknown> = { where: scopedWhere(this.scope, { [this.idField]: id }) }
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
    const where = scopedWhere(this.scope, options.where)
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
    try {
      return (await this.delegate.create({ data: stampTenant(this.scope, data) })) as TRecord
    } catch (error) {
      if (isDuplicateError(error)) throw new ConflictError()
      throw error
    }
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

    try {
      await this.delegate.createMany({ data: data.map((item) => stampTenant(this.scope, item)) })
    } catch (error) {
      if (isDuplicateError(error)) throw new ConflictError()
      throw error
    }
    return []
  }

  /**
   * Updates a single record identified by its ID with the provided data. If the record does not exist, it returns null.
   * The tenant-scoped path is delegated to {@link scopedUpdateOne} (atomic, fail-closed).
   * @param id - The ID of the record to be updated.
   * @param data - An object containing the data to update the record with.
   * @returns A promise that resolves to the updated record or null if the record does not exist.
   */
  public async updateOne(id: string | number, data: TUpdate): Promise<TRecord | null> {
    if (this.scope) {
      return (await scopedUpdateOne(
        this.delegate,
        this.scope,
        this.idField,
        id,
        data as Record<string, unknown>
      )) as TRecord | null
    }
    try {
      return (await this.delegate.update({ where: { [this.idField]: id }, data })) as TRecord
    } catch (error) {
      if (isNotFoundError(error)) return null
      if (isDuplicateError(error)) throw new ConflictError()
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
    const where = astToPrismaWhere(resolveScopedQuery(this.scope, query).where)
    const rows = (await this.delegate.findMany({
      where,
      select: { [this.idField]: true }
    })) as Array<Record<string, unknown>>
    await this.delegate.updateMany({ where, data: stripTenant(this.scope, data) })
    return { updated: rows.map((item) => item[this.idField]) }
  }

  /**
   * Upserts a single record by its ID, creating it when absent and updating it when present.
   * The tenant-scoped path is delegated to {@link scopedUpsertOne}, which enforces the tenant
   * constraint at every statement (never via `delegate.upsert`, whose update branch ignores it).
   * @param id - The ID of the record to be upserted.
   * @param data - The fields to create or update with.
   * @returns A promise that resolves to the upserted record.
   * @throws NotImplementedError if an unscoped delegate does not support upsert.
   */
  public async upsertOne(id: string | number, data: TCreate & TUpdate): Promise<TRecord> {
    if (this.scope) {
      return (await scopedUpsertOne(
        this.delegate,
        this.scope,
        this.idField,
        id,
        data as Record<string, unknown>
      )) as TRecord
    }

    if (!this.delegate.upsert) {
      throw new NotImplementedError('Prisma delegate does not support upsert.')
    }

    try {
      return (await this.delegate.upsert({
        where: { [this.idField]: id },
        create: data,
        update: data as TUpdate
      })) as TRecord
    } catch (error) {
      if (isDuplicateError(error)) throw new ConflictError()
      throw error
    }
  }

  /**
   * Deletes a single record identified by its ID. If the record does not exist, it returns false.
   * The tenant-scoped path is delegated to {@link scopedDeleteOne} (atomic, fail-closed).
   * @param id - The ID of the record to be deleted.
   * @returns A promise that resolves to true if the record was deleted, or false if it did not exist.
   */
  public async deleteOne(id: string | number): Promise<boolean> {
    if (this.scope) {
      return scopedDeleteOne(this.delegate, this.scope, this.idField, id)
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
    const where = astToPrismaWhere(resolveScopedQuery(this.scope, query).where)
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
    const resolved = resolveScopedQuery(this.scope, query)
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
