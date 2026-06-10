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
import { ServerError } from '@/errors/ServerError.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PrismaDelegate {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findUnique?(args: any): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findFirst?(args: any): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany(args?: any): Promise<any[]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  count(args?: any): Promise<number>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(args: any): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createMany?(args: any): Promise<{ count: number }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(args: any): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateMany?(args: any): Promise<{ count: number }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsert?(args: any): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete(args: any): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteMany?(args: any): Promise<{ count: number }>
}

export interface PrismaNativeClient {
  $queryRawUnsafe?<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe?<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

export interface PrismaAdapterOptions<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> {
  delegate: PrismaDelegate
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

  public readonly capabilities: RepositoryCapabilities

  public constructor(options: PrismaAdapterOptions<TRecord, TCreate, TUpdate>) {
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
      return (await this.delegate.findUnique(args)) as TRecord | null
    }

    if (this.delegate.findFirst) {
      return (await this.delegate.findFirst(args)) as TRecord | null
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

    return { count, results: results as TRecord[] }
  }

  public async createOne(data: TCreate): Promise<TRecord> {
    return (await this.delegate.create({ data })) as TRecord
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
      return (await this.delegate.update({ where: { [this.idField]: id }, data })) as TRecord
    } catch {
      return null
    }
  }

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

