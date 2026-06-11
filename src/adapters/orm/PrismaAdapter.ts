import { QueryBuilder } from '@/classes/QueryBuilder.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'
import type {
  Repository,
  RepositoryCapabilities,
  DeleteManyResult,
  ListOptions,
  ListResult,
  NativeQueryResult,
  UpdateManyResult
} from '@/core/repository.js'
import type {
  FieldDefinition,
  RelationDefinition,
  ModelField,
  ModelSchema,
  ModelResourceOptions,
  ResourceDefinition,
  CrudPermissions
} from '@/core/types.js'
import { ServerError } from '@/errors/ServerError.js'

/**
 * Structural interface that any Prisma model delegate satisfies.
 * All method signatures intentionally use `any` so that generated Prisma delegates
 * can be passed without casting.
 */
export interface PrismaDelegate {
  findUnique?(args: any): Promise<any>
  findFirst?(args: any): Promise<any>
  findMany(args?: any): Promise<any[]>
  count(args?: any): Promise<number>
  create(args: any): Promise<any>
  createMany?(args: any): Promise<{ count: number }>
  update(args: any): Promise<any>
  updateMany?(args: any): Promise<{ count: number }>
  upsert?(args: any): Promise<any>
  delete(args: any): Promise<any>
  deleteMany?(args: any): Promise<{ count: number }>
}

/** Minimal Prisma client interface needed for raw SQL execution. */
export interface PrismaNativeClient {
  /** Execute a raw SQL query and return typed rows. */
  $queryRawUnsafe?<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  /** Execute a raw SQL statement without returning rows. */
  $executeRawUnsafe?<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

/** Construction options for {@link PrismaAdapter}. */
export interface PrismaAdapterOptions {
  /** The Prisma model delegate (e.g. `prisma.user`). */
  delegate: PrismaDelegate
  /** The Prisma client instance — required for raw SQL operations (updateMany, deleteMany, query builder). */
  client?: PrismaNativeClient
  /** Name of the primary key field (default: `'id'`). */
  idField?: string
  /** Database table name — required for raw SQL operations. */
  tableName?: string
  /** When true, createMany falls back to serial createOne calls so records are returned. */
  returnCreated?: boolean
  /** Prisma DMMF model — when provided, fields and relations are derived automatically. */
  model?: ModelSchema
}

/**
 * Converts a field list to a Prisma `select` argument.
 * @param fields - Column names to include, or `undefined` for all columns.
 * @returns A `{ [field]: true }` map for Prisma's `select`, or `undefined` when `fields` is empty.
 */
function toSelect(fields?: string[]): Record<string, boolean> | undefined {
  if (!fields?.length) {
    return undefined
  }

  return Object.fromEntries(
    fields.map((field) => {
      return [field, true]
    })
  )
}

/**
 * Converts a relation list to a Prisma `include` argument.
 * @param include - Relation names to eager-load, or `undefined`.
 * @returns A `{ [relation]: true }` map for Prisma's `include`, or `undefined` when empty.
 */
function toInclude(include?: string[]): Record<string, boolean> | undefined {
  if (!include?.length) {
    return undefined
  }

  return Object.fromEntries(
    include.map((relation) => {
      return [relation, true]
    })
  )
}

/**
 * Converts Halifax sort expressions to Prisma's `orderBy` array format.
 * @param orderBy - Halifax sort array, or `undefined`.
 * @returns A Prisma `orderBy` array (e.g. `[{ name: 'asc' }]`), or `undefined` when empty.
 */
function toOrderBy(
  orderBy?: ListOptions['orderBy']
): Array<Record<string, 'asc' | 'desc'>> | undefined {
  if (!orderBy?.length) {
    return undefined
  }

  return orderBy.map((sort) => {
    return { [sort.field]: sort.direction }
  })
}

/**
 * Repository adapter that connects Halifax to a Prisma ORM model delegate.
 *
 * Pass `model: Prisma.dmmf.datamodel.models.find(m => m.name === 'User')` to enable
 * automatic field/relation introspection — no manual `fields` array required.
 */
export class PrismaAdapter<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> implements Repository<TRecord, TCreate, TUpdate> {
  private readonly delegate: PrismaDelegate
  private readonly client?: PrismaNativeClient | undefined
  private readonly idField: string
  private readonly tableName?: string | undefined
  private readonly returnCreated: boolean

  /** Capability flags for this adapter instance. */
  public readonly capabilities: RepositoryCapabilities
  /** Field definitions derived from the DMMF model, if one was provided. */
  public readonly fields: FieldDefinition[] | undefined
  /** Relation definitions derived from the DMMF model, if one was provided. */
  public readonly relations: RelationDefinition[] | undefined

  /**
   * @param options - Delegate, optional Prisma client, ID field name, table name, and optional DMMF model.
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
   * Derives {@link FieldDefinition}[] from a Prisma DMMF model.
   * Relation fields (`kind === 'object'`) are excluded; ID and read-only fields get `writable: false`.
   * @param model - The Prisma DMMF model to introspect.
   * @returns Array of field definitions representing the model's scalar columns.
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
   * Derives {@link RelationDefinition}[] from a Prisma DMMF model.
   * Only relation fields (`kind === 'object'`) are included, all marked `includable: true`.
   * @param model - The Prisma DMMF model to introspect.
   * @returns Array of relation definitions representing the model's associations.
   */
  public static relationsFromModel(model: ModelSchema): RelationDefinition[] {
    return model.fields
      .filter((f) => f.kind === 'object')
      .map((f) => ({ name: f.name, includable: true }))
  }

  /**
   * Fetches a single record by primary key using `findUnique` (or `findFirst` as fallback).
   * @param id - Primary key value (integer or UUID string).
   * @param options - Optional field projection and relation includes.
   * @returns The matching record, or `null` when not found.
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
   * Fetches a paginated list of records using `count` + `findMany` in parallel.
   * @param options - Pagination, filtering, sorting, and projection options.
   * @returns A count-and-results envelope for the current page.
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
   * Inserts a single record via Prisma's `create`.
   * @param data - Record fields to insert.
   * @returns The newly created record.
   */
  public async createOne(data: TCreate): Promise<TRecord> {
    return (await this.delegate.create({ data })) as TRecord
  }

  /**
   * Inserts multiple records.
   * Uses serial `createOne` calls when `createMany` is unavailable or `returnCreated` is true.
   * Otherwise uses Prisma's `createMany` (which does not return the created rows).
   * @param data - Array of record field objects to insert.
   * @returns The created records, or an empty array when using bulk insert.
   */
  public async createMany(data: TCreate[]): Promise<TRecord[]> {
    if (!this.delegate.createMany || this.returnCreated) {
      return await Promise.all(
        data.map(async (item) => {
          return await this.createOne(item)
        })
      )
    }

    await this.delegate.createMany({ data })
    return []
  }

  /**
   * Updates a single record by primary key.
   * @param id - Primary key of the record to update.
   * @param data - Fields to apply to the record.
   * @returns The updated record, or `null` when not found.
   */
  public async updateOne(id: string | number, data: TUpdate): Promise<TRecord | null> {
    try {
      return (await this.delegate.update({ where: { [this.idField]: id }, data })) as TRecord
    } catch {
      return null
    }
  }

  /**
   * Updates multiple records matching a raw SQL query.
   * Requires both a `client` and a `tableName` to be set on the adapter.
   * @param query - Query AST describing which rows to update.
   * @param data - Fields to apply to all matching rows.
   * @returns IDs of the updated rows.
   * @throws {@link NotImplementedError} when `client` or `tableName` is not configured.
   */
  public async updateMany(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>> {
    if (!this.client?.$queryRawUnsafe || !this.tableName) {
      throw new NotImplementedError('Native SQL updateMany requires a Prisma client and tableName.')
    }

    const updateQuery = QueryBuilder.buildUpdateQuery(
      { ...query, tableName: query.tableName || this.tableName },
      data as Record<string, unknown>
    )
    const selectQuery = QueryBuilder.buildSelectQuery({
      ...query,
      tableName: query.tableName || this.tableName,
      fields: ['id']
    })
    const selected = await this.client.$queryRawUnsafe<Array<Record<string, unknown>>>(
      selectQuery.statement,
      ...selectQuery.parameters
    )
    await this.client.$queryRawUnsafe(updateQuery.statement, ...updateQuery.parameters)

    return {
      updated: selected.map((item) => {
        return item.id
      })
    }
  }

  /**
   * Inserts or updates a single record by primary key using Prisma's `upsert`.
   * @param id - Primary key to match for the update, or use for the insert.
   * @param data - Fields to create or update.
   * @returns The created or updated record.
   * @throws {@link NotImplementedError} when the delegate does not support `upsert`.
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
   * Deletes a single record by primary key.
   * @param id - Primary key of the record to delete.
   * @returns `true` when deleted successfully, `false` when not found.
   */
  public async deleteOne(id: string | number): Promise<boolean> {
    try {
      await this.delegate.delete({ where: { [this.idField]: id } })
      return true
    } catch {
      return false
    }
  }

  /**
   * Deletes multiple records matching a raw SQL query.
   * Requires both a `client` and a `tableName` to be set on the adapter.
   * @param query - Query AST describing which rows to delete.
   * @returns IDs of the deleted rows.
   * @throws {@link NotImplementedError} when `client` or `tableName` is not configured.
   */
  public async deleteMany(query: IQueryOptions): Promise<DeleteManyResult> {
    if (!this.client?.$queryRawUnsafe || !this.tableName) {
      throw new NotImplementedError('Native SQL deleteMany requires a Prisma client and tableName.')
    }

    const resolvedQuery = { ...query, tableName: query.tableName || this.tableName, fields: ['id'] }
    const selectQuery = QueryBuilder.buildSelectQuery(resolvedQuery)
    const deleteQuery = QueryBuilder.buildDeleteQuery(resolvedQuery)

    const selected = await this.client.$queryRawUnsafe<Array<Record<string, unknown>>>(
      selectQuery.statement,
      ...selectQuery.parameters
    )
    await this.client.$queryRawUnsafe(deleteQuery.statement, ...deleteQuery.parameters)

    return {
      deleted: selected.map((item) => {
        return item.id
      })
    }
  }

  /**
   * Executes a query-builder AST, returning a count + page of results via raw SQL.
   * Requires both a `client` and a `tableName` to be set on the adapter.
   * @param query - Full query AST including table name, filters, pagination, and sort.
   * @returns A count-and-results envelope for the matching rows.
   * @throws {@link NotImplementedError} when `client` or `tableName` is not configured.
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

/** Global options for {@link createPrismaResources}. */
export interface CreatePrismaResourcesOptions {
  /** Per-model overrides. Key is the Prisma model name (e.g. `'User'`, `'BlogPost'`). */
  models?: Record<string, ModelResourceOptions>
  /** Permission overrides applied to every resource (before per-model overrides). */
  permissions?: CrudPermissions
  /** Default page size for all resources (overridden per model). */
  defaultLimit?: number
  /** Hard page-size cap for all resources (overridden per model). */
  maxLimit?: number
  /** Primary key field name for every model (default: `'id'`). */
  idField?: string
  /** When true, `createMany` returns created records via serial inserts (default: false). */
  returnCreated?: boolean
}

/**
 * Derives the pluralised kebab-case URL prefix from a PascalCase Prisma model name.
 * Examples: `User` → `users`, `BlogPost` → `blog-posts`, `Category` → `categories`.
 * @param modelName - PascalCase model name (e.g. `'BlogPost'`).
 * @returns Pluralised kebab-case route prefix (e.g. `'blog-posts'`).
 */
function toRoutePrefix(modelName: string): string {
  const kebab = modelName.replace(/([A-Z])/g, (m, l, i) => (i > 0 ? '-' : '') + l.toLowerCase())
  if (kebab.endsWith('y') && !/[aeiou]y$/.test(kebab)) return kebab.slice(0, -1) + 'ies'
  if (/(?:s|x|z|ch|sh)$/.test(kebab)) return kebab + 'es'
  return kebab + 's'
}

/**
 * Generates a {@link ResourceDefinition} for every model in the provided schema, with all
 * CRUD operations enabled by default. Pass per-model overrides to exclude models,
 * restrict permissions, or customise routing.
 *
 * @param prismaClient - Your Prisma client instance (e.g. `new PrismaClient()`).
 * @param schema - Prisma DMMF model array — pass `Prisma.dmmf.datamodel.models`.
 * @param options - Global defaults and per-model overrides.
 * @returns An array of resource definitions ready to pass to {@link createExpressCrudRouter}.
 *
 * @example
 * import { Prisma } from '@prisma/client'
 * const resources = createPrismaResources(prisma, Prisma.dmmf.datamodel.models, {
 *   models: { AuditLog: { exclude: true } },
 *   defaultLimit: 50
 * })
 */
export function createPrismaResources(
  prismaClient: object,
  schema: ReadonlyArray<{ name: string; dbName?: string | null; fields: ModelField[] }>,
  options: CreatePrismaResourcesOptions = {}
): ResourceDefinition[] {
  const client = prismaClient as any

  return schema
    .filter((model) => !options.models?.[model.name]?.exclude)
    .map((model) => {
      const modelOpts = options.models?.[model.name] ?? {}
      const tableName = modelOpts.tableName ?? model.dbName ?? model.name
      const routePrefix = modelOpts.routePrefix ?? toRoutePrefix(model.name)
      const delegateKey = model.name.charAt(0).toLowerCase() + model.name.slice(1)

      const adapter = new PrismaAdapter({
        delegate: client[delegateKey] as PrismaDelegate,
        client: client as PrismaNativeClient,
        tableName,
        ...(options.idField !== undefined && { idField: options.idField }),
        ...(options.returnCreated !== undefined && { returnCreated: options.returnCreated }),
        model
      })

      const resource: ResourceDefinition = {
        name: model.name,
        routePrefix,
        tableName,
        fields: adapter.fields!,
        repository: adapter,
        permissions: { ...options.permissions, ...modelOpts.permissions }
      }
      if (adapter.relations?.length) resource.relations = adapter.relations
      if (modelOpts.requiredPermissions)
        resource.requiredPermissions = modelOpts.requiredPermissions
      const defaultLimit = modelOpts.defaultLimit ?? options.defaultLimit
      const maxLimit = modelOpts.maxLimit ?? options.maxLimit
      const maxFilterDepth = modelOpts.maxFilterDepth
      if (defaultLimit !== undefined) resource.defaultLimit = defaultLimit
      if (maxLimit !== undefined) resource.maxLimit = maxLimit
      if (maxFilterDepth !== undefined) resource.maxFilterDepth = maxFilterDepth
      return resource
    })
}
