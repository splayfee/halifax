import { QueryBuilder } from '@/classes/QueryBuilder.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { ServerError } from '@/errors/ServerError.js'

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
  NativeQueryResult,
  UpdateManyResult
} from '@/core/types.js'
import type { FieldDefinition, RelationDefinition, ModelSchema } from '@/core/types.js'
import type { PrismaDelegate, PrismaNativeClient, PrismaAdapterOptions } from './types.js'
import { toSelect, toInclude, toOrderBy } from './helpers.js'

/**
 * PrismaAdapter is a generic repository implementation that uses Prisma delegates to perform database operations.
 * It supports basic CRUD operations and can be extended to support more complex queries.
 * The adapter can optionally use a Prisma client for executing raw SQL queries when needed.
 * It also extracts field and relation definitions from a provided Prisma model schema to enhance query capabilities.
 */
export class PrismaAdapter<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> implements Repository<TRecord, TCreate, TUpdate> {
  /** Private properties to hold the Prisma delegate, client, and configuration options. */
  private readonly delegate: PrismaDelegate
  /**  Optional Prisma client for executing raw SQL queries, required for certain operations like updateMany and deleteMany. */
  private readonly client?: PrismaNativeClient | undefined
  /** The field name used for the primary key in the model. */
  private readonly idField: string
  /** The name of the database table associated with the model. */
  private readonly tableName?: string | undefined
  /** A flag indicating whether to return created records. */
  private readonly returnCreated: boolean

  /** A set of capabilities that the repository supports. */
  public readonly capabilities: RepositoryCapabilities
  /** An array of field definitions for the model. */
  public readonly fields: FieldDefinition[] | undefined
  /** An array of relation definitions for the model. */
  public readonly relations: RelationDefinition[] | undefined

  /**
   * Constructs a new instance of PrismaAdapter with the provided options.
   * @param options - An object containing the Prisma delegate, optional client, and configuration settings for the adapter.
   */
  public constructor(options: PrismaAdapterOptions) {
    this.delegate = options.delegate
    this.client = options.client
    this.idField = options.idField ?? 'id'
    this.tableName = options.tableName
    this.returnCreated = options.returnCreated ?? false

    this.capabilities = {
      supportsNativeSql: !!options.client,
      supportsIncludes: true,
      supportsTransactions: false,
      supportsCreateManyReturn: this.returnCreated,
      supportsNoSqlQueryAst: false
    }

    if (options.model) {
      this.fields = PrismaAdapter.fieldsFromModel(options.model)
      this.relations = PrismaAdapter.relationsFromModel(options.model)
    }
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
    const args: Record<string, unknown> = { where: { [this.idField]: id } }
    if (select) args.select = select
    else if (include) args.include = include

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
    const args: Record<string, unknown> = {
      where: options.where,
      orderBy: toOrderBy(options.orderBy),
      skip: options.offset,
      take: options.limit
    }
    if (select) args.select = select
    else if (include) args.include = include

    const [count, results] = await Promise.all([
      this.delegate.count({ where: options.where }),
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
    return (await this.delegate.create({ data })) as TRecord
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

    await this.delegate.createMany({ data })
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
    try {
      return (await this.delegate.update({ where: { [this.idField]: id }, data })) as TRecord
    } catch (error) {
      if (isNotFoundError(error)) return null
      throw error
    }
  }

  /**
   * Updates multiple records that match the provided query options with the given data.
   * This method requires a Prisma client for executing raw SQL queries, as Prisma does not
   * natively support bulk updates with return values. It first selects the IDs of the records
   * to be updated based on the query options, then executes an update query, and finally returns
   * the IDs of the updated records.
   *
   * **Note:** The SELECT and UPDATE are issued as two separate queries without a transaction.
   * Under concurrent writes, rows inserted or deleted between the two queries may cause the
   * returned `updated` IDs to differ from the rows actually modified.
   *
   * @param query - An object containing query options to filter the records that should be updated, such as where conditions, sorting, and pagination.
   * @param data - An object containing the data to update the matching records with.
   * @returns A promise that resolves to an object containing an array of the IDs of the updated records.
   * @throws NotImplementedError if the Prisma client or tableName is not provided, as they are required for executing raw SQL queries.
   * @throws ServerError if the Prisma client does not support the required methods for executing raw SQL queries.
   */
  public async updateMany(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>> {
    if (!this.client?.$queryRawUnsafe || !this.tableName) {
      throw new NotImplementedError('Native SQL updateMany requires a Prisma client and tableName.')
    }

    const updateQuery = QueryBuilder.buildUpdateQuery(
      { ...query, tableName: query.tableName || this.tableName },
      data as Record<string, unknown>,
      [this.idField],
      this.idField
    )
    const updated = await this.client.$queryRawUnsafe<Array<Record<string, unknown>>>(
      updateQuery.statement,
      ...updateQuery.parameters
    )

    return { updated: updated.map((item) => item[this.idField]) }
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
   * @param query - An object containing query options to filter the records that should be deleted, such as where conditions, sorting, and pagination.
   * @returns A promise that resolves to an object containing an array of the IDs of the deleted records.
   * @throws NotImplementedError if the Prisma client or tableName is not provided, as they are required for executing raw SQL queries.
   * @throws ServerError if the Prisma client does not support the required methods for executing raw SQL queries.
   */
  public async deleteMany(query: IQueryOptions): Promise<DeleteManyResult> {
    if (!this.client?.$queryRawUnsafe || !this.tableName) {
      throw new NotImplementedError('Native SQL deleteMany requires a Prisma client and tableName.')
    }

    const resolvedQuery = { ...query, tableName: query.tableName || this.tableName }
    const deleteQuery = QueryBuilder.buildDeleteQuery(resolvedQuery, [this.idField])

    const deleted = await this.client.$queryRawUnsafe<Array<Record<string, unknown>>>(
      deleteQuery.statement,
      ...deleteQuery.parameters
    )

    return { deleted: deleted.map((item) => item[this.idField]) }
  }

  /**
   * Executes a query built using the QueryBuilder, which allows for complex filtering, sorting, pagination, and field selection. This method requires a Prisma client for executing raw SQL queries, as it relies on the QueryBuilder to generate SQL statements. It first builds a count query to get the total number of matching records and then builds a select query to retrieve the actual records based on the provided query options.
   *
   * **Note:** The COUNT and SELECT are issued as two separate queries without a transaction.
   * Under concurrent writes, rows inserted or deleted between the two queries may cause the
   * returned `count` to differ from the actual number of rows in `results`.
   *
   * @param query - An object containing query options such as filtering conditions, sorting, pagination, and field selection, which will be used to build the SQL queries.
   * @returns A promise that resolves to an object containing the total count of matching records and an array of the retrieved records.
   * @throws NotImplementedError if the Prisma client or tableName is not provided, as they are required for executing raw SQL queries.
   * @throws ServerError if the Prisma client does not support the required methods for executing raw SQL queries.
   */
  public async executeQueryBuilder(query: IQueryOptions): Promise<NativeQueryResult<TRecord>> {
    if (!this.client?.$queryRawUnsafe || !this.tableName) {
      throw new NotImplementedError(
        'Native SQL query-builder requires a Prisma client and tableName.'
      )
    }

    const resolvedQuery = { ...query, tableName: query.tableName || this.tableName }
    const countQuery = QueryBuilder.buildCountQuery(resolvedQuery)
    const selectQuery = QueryBuilder.buildSelectQuery(resolvedQuery)

    const countRows = await this.client.$queryRawUnsafe<Array<{ count: number }>>(
      countQuery.statement,
      ...countQuery.parameters
    )
    const results = await this.client.$queryRawUnsafe<TRecord[]>(
      selectQuery.statement,
      ...selectQuery.parameters
    )

    return {
      count: Number(countRows[0]?.count ?? 0),
      results
    }
  }
}
