import { QueryBuilder } from '@/classes/QueryBuilder.js'
import { HttpError } from '@/errors/HttpError.js'
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
import { ServerError } from '@/index.js'

export interface PrismaDelegate<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> {
  findUnique?(args: Record<string, unknown>): Promise<TRecord | null>
  findFirst?(args: Record<string, unknown>): Promise<TRecord | null>
  findMany(args?: Record<string, unknown>): Promise<TRecord[]>
  count(args?: Record<string, unknown>): Promise<number>
  create(args: { data: TCreate }): Promise<TRecord>
  createMany?(args: { data: TCreate[] }): Promise<{ count: number }>
  update(args: { where: Record<string, unknown>; data: TUpdate }): Promise<TRecord>
  updateMany?(args: { where?: Record<string, unknown>; data: TUpdate }): Promise<{ count: number }>
  upsert?(args: {
    where: Record<string, unknown>
    create: TCreate & TUpdate
    update: TUpdate
  }): Promise<TRecord>
  delete(args: { where: Record<string, unknown> }): Promise<TRecord>
  deleteMany?(args: { where?: Record<string, unknown> }): Promise<{ count: number }>
}

export interface PrismaNativeClient {
  $queryRawUnsafe?<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe?<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

export interface PrismaRepositoryAdapterOptions<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> {
  delegate: PrismaDelegate<TRecord, TCreate, TUpdate>
  client?: PrismaNativeClient
  idField?: string
  tableName?: string
  /** When true, createMany falls back to serial createOne calls so records are returned. */
  returnCreated?: boolean
}

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

export class PrismaRepositoryAdapter<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> implements Repository<TRecord, TCreate, TUpdate> {
  private readonly delegate: PrismaDelegate<TRecord, TCreate, TUpdate>
  private readonly client?: PrismaNativeClient | undefined
  private readonly idField: string
  private readonly tableName?: string | undefined
  private readonly returnCreated: boolean

  public readonly capabilities: RepositoryCapabilities

  public constructor(options: PrismaRepositoryAdapterOptions<TRecord, TCreate, TUpdate>) {
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
  }

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
      return await this.delegate.findUnique(args)
    }

    if (this.delegate.findFirst) {
      return await this.delegate.findFirst(args)
    }

    throw new ServerError('Prisma delegate does not support findUnique or findFirst.')
  }

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

    return { count, results }
  }

  public async createOne(data: TCreate): Promise<TRecord> {
    return await this.delegate.create({ data })
  }

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

  public async updateOne(id: string | number, data: TUpdate): Promise<TRecord | null> {
    try {
      return await this.delegate.update({ where: { [this.idField]: id }, data })
    } catch {
      return null
    }
  }

  public async updateMany(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>> {
    if (!this.client?.$queryRawUnsafe || !this.tableName) {
      throw new ServerError('Native SQL updateMany requires a Prisma client and tableName.', 501)
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

  public async upsertOne(id: string | number, data: TCreate & TUpdate): Promise<TRecord> {
    if (!this.delegate.upsert) {
      throw new ServerError('Prisma delegate does not support upsert.', 501)
    }

    return await this.delegate.upsert({
      where: { [this.idField]: id },
      create: data,
      update: data as TUpdate
    })
  }

  public async deleteOne(id: string | number): Promise<boolean> {
    try {
      await this.delegate.delete({ where: { [this.idField]: id } })
      return true
    } catch {
      return false
    }
  }

  public async deleteMany(query: IQueryOptions): Promise<DeleteManyResult> {
    if (!this.client?.$queryRawUnsafe || !this.tableName) {
      throw new ServerError('Native SQL deleteMany requires a Prisma client and tableName.', 501)
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

  public async executeQueryBuilder(query: IQueryOptions): Promise<NativeQueryResult<TRecord>> {
    if (!this.client?.$queryRawUnsafe || !this.tableName) {
      throw new HttpError('Native SQL query-builder requires a Prisma client and tableName.', 501)
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
