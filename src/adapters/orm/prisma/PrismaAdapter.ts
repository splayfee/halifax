import type { IQueryFilter, IQueryOptions, QueryScalar } from '@edium/halifax-types'
import type {
  DeleteManyResult,
  FieldDefinition,
  FieldType,
  ListOptions,
  ListResult,
  ModelSchema,
  QueryResult,
  RelationDefinition,
  Repository,
  RepositoryCapabilities,
  TenantScope,
  UpdateManyResult
} from '@/core/types.js'
import type { PrismaAdapterOptions, PrismaDelegate } from './types.js'
import { ConflictError } from '@/errors/ConflictError.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { ServerError } from '@/errors/ServerError.js'
import { astToPrismaOrderBy, astToPrismaWhere } from './astToPrisma.js'
import { toInclude, toOrderBy, toSelect } from './helpers.js'

/** Returns true for Prisma's P2025 "record not found" error. */
function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Record<string, unknown>).code === 'P2025'
  )
}

/** Returns true for Prisma's P2002 unique constraint violation. */
function isDuplicateError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Record<string, unknown>).code === 'P2002'
  )
}

/**
 * Returns true for SQL Server's "IDENTITY_INSERT is set to OFF" error (code 544).
 * MSSQL IDENTITY columns reject any explicit-value INSERT via the driver adapter rather
 * than surfacing a P2002 duplicate — so this must be caught separately.
 */
function isIdentityInsertError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const cause = (error as Record<string, unknown>).cause
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as Record<string, unknown>).code === 544
  )
}

function prismaTypeToOpenApi(prismaType?: string): { type?: FieldType; format?: string } {
  switch (prismaType) {
    case 'Int':
      return { type: 'integer', format: 'int32' }
    case 'BigInt':
      return { type: 'integer', format: 'int64' }
    case 'Float':
      return { type: 'number', format: 'float' }
    case 'Decimal':
      return { type: 'number', format: 'double' }
    case 'Boolean':
      return { type: 'boolean' }
    case 'DateTime':
      return { type: 'string', format: 'date-time' }
    case 'Json':
      return { type: 'object' }
    case 'Bytes':
      return { type: 'string', format: 'binary' }
    default:
      return {}
  }
}

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
        writable: !f.isId && !f.isReadOnly,
        ...prismaTypeToOpenApi(f.type)
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
    try {
      return (await this.delegate.create({ data: this.stampTenant(data) })) as TRecord
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
      await this.delegate.createMany({ data: data.map((item) => this.stampTenant(item)) })
    } catch (error) {
      if (isDuplicateError(error)) throw new ConflictError()
      throw error
    }
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
    if (this.scope) {
      const scopedWhere = this.scopedWhere({ [this.idField]: id })

      // Preferred path: delegate.updateMany lets us do a single atomic statement whose
      // WHERE enforces the tenant boundary, eliminating the TOCTOU window.
      if (this.delegate.updateMany && this.delegate.findFirst) {
        const { count } = await this.delegate.updateMany({
          where: scopedWhere,
          data: this.stripTenant(data)
        })
        if (count === 0) return null
        return (await this.delegate.findFirst({ where: scopedWhere })) as TRecord | null
      }

      // updateMany is unavailable — we cannot perform a single atomic scoped update.
      // A two-step findFirst + unscoped update would introduce a TOCTOU window where a
      // record could be transferred to another tenant between the check and the write.
      // Refuse rather than risk a cross-tenant modification.
      throw new ServerError(
        'Prisma delegate does not support updateMany (required for safe tenant-scoped updateOne).'
      )
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
    // Scoped upsert: do NOT use delegate.upsert with a bare id where-clause — Prisma's upsert
    // would execute its `update` branch against any matching record regardless of tenant, giving
    // a cross-tenant write if a race places another tenant's row at that id. Instead we decompose
    // into a scoped findFirst + a scoped updateMany (create on miss) so the tenant constraint is
    // enforced at every statement.
    if (this.scope) {
      if (!this.delegate.findFirst) {
        throw new ServerError(
          'Prisma delegate does not support findFirst (required for tenant scoping).'
        )
      }
      const scopedWhere = this.scopedWhere({ [this.idField]: id })
      const existing = (await this.delegate.findFirst({
        where: scopedWhere
      })) as Record<string, unknown> | null

      // Defense-in-depth: even though scopedWhere already filters by tenant, verify the
      // returned record actually belongs to this tenant before treating it as owned.
      if (existing && existing[this.scope.field] !== this.scope.value) {
        throw new NotFoundError()
      }

      if (existing) {
        // Record exists for this tenant — update it atomically via updateMany(scopedWhere)
        // so the tenant constraint is enforced in the same SQL statement as the write.
        if (this.delegate.updateMany) {
          const { count } = await this.delegate.updateMany({
            where: scopedWhere,
            data: this.stripTenant(data)
          })
          if (count === 0) {
            // Deleted in the tiny window between findFirst and updateMany — treat as a
            // fresh create so the caller gets a record back (consistent with upsert semantics).
            try {
              return (await this.delegate.create({
                data: this.stampTenant({ ...data, [this.idField]: id } as TCreate)
              })) as TRecord
            } catch (error) {
              if (isDuplicateError(error)) throw new ConflictError()
              if (isIdentityInsertError(error)) {
                const anyMatch = await this.delegate.findFirst!({ where: { [this.idField]: id } })
                if (anyMatch) throw new ConflictError()
                return (await this.delegate.create({ data: this.stampTenant(data as TCreate) })) as TRecord
              }
              throw error
            }
          }
          return (await this.delegate.findFirst({ where: scopedWhere })) as TRecord
        }
        // Fallback when updateMany is unavailable (non-standard delegate). The update is still
        // scoped via the earlier findFirst; the TOCTOU window here is only closeable with a
        // transaction, which we cannot guarantee across providers.
        try {
          return (await this.delegate.update({
            where: { [this.idField]: id },
            data: this.stripTenant(data)
          })) as TRecord
        } catch (error) {
          if (isNotFoundError(error)) throw new NotFoundError()
          if (isDuplicateError(error)) throw new ConflictError()
          throw error
        }
      }

      // Record does not exist for this tenant — create it with the tenant stamped.
      try {
        return (await this.delegate.create({
          data: this.stampTenant({ ...data, [this.idField]: id } as TCreate)
        })) as TRecord
      } catch (error) {
        if (isDuplicateError(error)) throw new ConflictError()
        if (isIdentityInsertError(error)) {
          // MSSQL IDENTITY columns reject any explicit-ID insert. Probe to distinguish a
          // cross-tenant ID collision (another tenant owns this ID → ConflictError) from a
          // genuinely new row (let the DB assign the ID instead).
          const anyMatch = await this.delegate.findFirst!({ where: { [this.idField]: id } })
          if (anyMatch) throw new ConflictError()
          return (await this.delegate.create({ data: this.stampTenant(data as TCreate) })) as TRecord
        }
        throw error
      }
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
      // deleteMany is unavailable — we cannot do an atomic scoped delete. A two-step
      // findFirst + unscoped delete would introduce a TOCTOU cross-tenant deletion risk.
      throw new ServerError(
        'Prisma delegate does not support deleteMany (required for safe tenant-scoped deleteOne).'
      )
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
