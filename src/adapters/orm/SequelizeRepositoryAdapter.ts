import { QueryBuilder } from '@/classes/QueryBuilder.js'
import { HttpError } from '@/errors/HttpError.js'
import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'
import type { DeleteManyResult, ListOptions, ListResult, NativeQueryResult, Repository, UpdateManyResult } from '@/core/repository.js'

export interface SequelizeModelLike<TRecord = unknown, TCreate = Partial<TRecord>, TUpdate = Partial<TRecord>> {
  findByPk?(id: string | number, args?: Record<string, unknown>): Promise<TRecord | null>
  findOne?(args?: Record<string, unknown>): Promise<TRecord | null>
  findAndCountAll?(args?: Record<string, unknown>): Promise<{ count: number; rows: TRecord[] }>
  findAll?(args?: Record<string, unknown>): Promise<TRecord[]>
  count?(args?: Record<string, unknown>): Promise<number>
  create(data: TCreate): Promise<TRecord>
  bulkCreate?(data: TCreate[]): Promise<TRecord[]>
  update?(data: TUpdate, args?: Record<string, unknown>): Promise<[number, TRecord[]] | [number]>
  upsert?(data: TCreate & TUpdate): Promise<[TRecord, boolean] | TRecord>
  destroy?(args?: Record<string, unknown>): Promise<number>
}

export interface SequelizeNativeClient {
  query<T = unknown>(statement: string, options?: { replacements?: unknown[]; type?: unknown }): Promise<T>
}

export interface SequelizeRepositoryAdapterOptions<TRecord = unknown, TCreate = Partial<TRecord>, TUpdate = Partial<TRecord>> {
  model: SequelizeModelLike<TRecord, TCreate, TUpdate>
  sequelize?: SequelizeNativeClient
  idField?: string
  tableName?: string
  queryTypes?: { select?: unknown; update?: unknown; delete?: unknown }
}

function toAttributes(fields?: string[]): string[] | undefined { return fields?.length ? fields : undefined }
function toOrder(orderBy?: ListOptions['orderBy']): Array<[string, string]> | undefined { return orderBy?.map((sort) => [sort.field, sort.direction.toUpperCase()]) }

export class SequelizeRepositoryAdapter<TRecord = unknown, TCreate = Partial<TRecord>, TUpdate = Partial<TRecord>> implements Repository<TRecord, TCreate, TUpdate> {
  private readonly model: SequelizeModelLike<TRecord, TCreate, TUpdate>
  private readonly sequelize?: SequelizeNativeClient | undefined
  private readonly idField: string
  private readonly tableName?: string | undefined
  private readonly queryTypes?: SequelizeRepositoryAdapterOptions['queryTypes']

  public constructor(options: SequelizeRepositoryAdapterOptions<TRecord, TCreate, TUpdate>) {
    this.model = options.model
    this.sequelize = options.sequelize
    this.idField = options.idField ?? 'id'
    this.tableName = options.tableName
    this.queryTypes = options.queryTypes
  }

  public async getOne(id: string | number, options?: Pick<ListOptions, 'fields'>): Promise<TRecord | null> {
    if (this.model.findByPk) return await this.model.findByPk(id, { attributes: toAttributes(options?.fields) })
    if (this.model.findOne) return await this.model.findOne({ where: { [this.idField]: id }, attributes: toAttributes(options?.fields) })
    throw new HttpError('Sequelize model does not support findByPk or findOne.', 500)
  }

  public async getMany(options: ListOptions = {}): Promise<ListResult<TRecord>> {
    const args = { where: options.where, attributes: toAttributes(options.fields), order: toOrder(options.orderBy), offset: options.offset, limit: options.limit }
    if (this.model.findAndCountAll) {
      const result = await this.model.findAndCountAll(args)
      return { count: result.count, results: result.rows }
    }
    const [count, results] = await Promise.all([this.model.count ? this.model.count({ where: options.where }) : Promise.resolve(0), this.model.findAll ? this.model.findAll(args) : Promise.resolve([])])
    return { count, results }
  }

  public async createOne(data: TCreate): Promise<TRecord> { return await this.model.create(data) }
  public async createMany(data: TCreate[]): Promise<TRecord[]> { return this.model.bulkCreate ? await this.model.bulkCreate(data) : await Promise.all(data.map((item) => this.createOne(item))) }

  public async updateOne(id: string | number, data: TUpdate): Promise<TRecord | null> {
    if (!this.model.update) throw new HttpError('Sequelize model does not support update.', 501)
    await this.model.update(data, { where: { [this.idField]: id } })
    return await this.getOne(id)
  }

  public async updateMany(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>> {
    if (!this.sequelize || !this.tableName) throw new HttpError('Native SQL updateMany requires sequelize and tableName.', 501)
    const updateQuery = QueryBuilder.buildUpdateQuery({ ...query, tableName: query.tableName || this.tableName }, data as Record<string, unknown>)
    await this.sequelize.query(updateQuery.statement, { replacements: updateQuery.parameters, type: this.queryTypes?.update })
    return { updated: [] }
  }

  public async upsertOne(id: string | number, data: TCreate & TUpdate): Promise<TRecord> {
    if (!this.model.upsert) throw new HttpError('Sequelize model does not support upsert.', 501)
    const result = await this.model.upsert({ ...data, [this.idField]: id })
    return Array.isArray(result) ? result[0] : result
  }

  public async deleteOne(id: string | number): Promise<boolean> {
    if (!this.model.destroy) throw new HttpError('Sequelize model does not support destroy.', 501)
    const count = await this.model.destroy({ where: { [this.idField]: id } })
    return count > 0
  }

  public async deleteMany(query: IQueryOptions): Promise<DeleteManyResult> {
    if (!this.sequelize || !this.tableName) throw new HttpError('Native SQL deleteMany requires sequelize and tableName.', 501)
    const resolvedQuery = { ...query, tableName: query.tableName || this.tableName, fields: ['id'] }
    const selectQuery = QueryBuilder.buildSelectQuery(resolvedQuery)
    const deleteQuery = QueryBuilder.buildDeleteQuery(resolvedQuery)
    const selected = await this.sequelize.query<Array<Record<string, unknown>>>(selectQuery.statement, { replacements: selectQuery.parameters, type: this.queryTypes?.select })
    await this.sequelize.query(deleteQuery.statement, { replacements: deleteQuery.parameters, type: this.queryTypes?.delete })
    return { deleted: selected.map((item) => item.id) }
  }

  public async executeQueryBuilder(query: IQueryOptions): Promise<NativeQueryResult<TRecord>> {
    if (!this.sequelize || !this.tableName) throw new HttpError('Native SQL query-builder requires sequelize and tableName.', 501)
    const resolvedQuery = { ...query, tableName: query.tableName || this.tableName }
    const countQuery = QueryBuilder.buildCountQuery(resolvedQuery)
    const selectQuery = QueryBuilder.buildSelectQuery(resolvedQuery)
    const countRows = await this.sequelize.query<Array<{ count: number }>>(countQuery.statement, { replacements: countQuery.parameters, type: this.queryTypes?.select })
    const results = await this.sequelize.query<TRecord[]>(selectQuery.statement, { replacements: selectQuery.parameters, type: this.queryTypes?.select })
    return { count: Number(countRows[0]?.count ?? 0), results }
  }
}
