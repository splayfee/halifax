import { Op } from 'sequelize'
import { ConflictError } from '@/errors/ConflictError.js'
import type { IQueryOptions } from '@edium/halifax-types'
import type {
  Repository,
  FieldDefinition,
  ListOptions,
  ListResult,
  QueryResult,
  UpdateManyResult,
  DeleteManyResult,
  TenantScope
} from '@/core/types.js'
import type { FieldType } from '@/core/types.js'
import { astToSequelizeWhere, astToSequelizeOrder } from './astToSequelize.js'

/** Minimal structural interface — any Sequelize v6 Model instance satisfies this. */
export interface SeqInstance {
  toJSON(): Record<string, unknown>
}

export interface SeqAttributeDefinition {
  primaryKey?: boolean
  type: unknown
}

/** Minimal structural interface for a Sequelize Model class (static side). */
export interface SeqModel {
  findOne(options?: object): Promise<SeqInstance | null>
  findAll(options?: object): Promise<SeqInstance[]>
  count(options?: object): Promise<number>
  create(values: Record<string, unknown>, options?: object): Promise<SeqInstance>
  bulkCreate(values: Record<string, unknown>[], options?: object): Promise<SeqInstance[]>
  /** Returns `[affectedCount, updatedInstances]`; `updatedInstances` only on Postgres + MSSQL. */
  update(
    values: Record<string, unknown>,
    options: object
  ): Promise<[number, SeqInstance[] | undefined]>
  destroy(options: object): Promise<number>
  rawAttributes: Record<string, SeqAttributeDefinition>
  sequelize?: { getDialect(): string }
}

export interface SequelizeAdapterConfig {
  idField?: string
}

function isDuplicateError(error: unknown): boolean {
  return (error as { name?: string })?.name === 'SequelizeUniqueConstraintError'
}

const SEQ_TYPE_MAP: Record<string, { type?: FieldType; format?: string }> = {
  STRING: { type: 'string' }, TEXT: { type: 'string' }, CITEXT: { type: 'string' },
  UUID: { type: 'string' }, CHAR: { type: 'string' },
  INTEGER: { type: 'integer' }, BIGINT: { type: 'integer' }, SMALLINT: { type: 'integer' },
  TINYINT: { type: 'integer' }, MEDIUMINT: { type: 'integer' },
  FLOAT: { type: 'number' }, DOUBLE: { type: 'number' }, DECIMAL: { type: 'number' },
  REAL: { type: 'number' }, NUMERIC: { type: 'number' },
  BOOLEAN: { type: 'boolean' },
  DATE: { type: 'string', format: 'date-time' }, DATEONLY: { type: 'string', format: 'date-time' },
  JSON: { type: 'object' }, JSONB: { type: 'object' }
}

function seqTypeToFieldType(attr: SeqAttributeDefinition): { type?: FieldType; format?: string } {
  const key = (attr.type as { key?: string })?.key ?? ''
  return SEQ_TYPE_MAP[key] ?? {}
}

/**
 * Sequelize v6 repository adapter for `@edium/halifax`.
 *
 * Supports PostgreSQL, MySQL, MariaDB, SQLite, and SQL Server (via `tedious`).
 * Relations / `?include=` are supported — pass Sequelize include objects through
 * `ListOptions.include` as `SequelizeAssociationInclude[]` cast to `string[]`.
 *
 * `updateOne` uses a single RETURNING query on Postgres + MSSQL, and a two-round-trip
 * UPDATE → SELECT on MySQL, MariaDB, and SQLite.
 */
export class SequelizeAdapter<
  TRecord = Record<string, unknown>,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> implements Repository<TRecord, TCreate, TUpdate> {
  public readonly fields: FieldDefinition[]
  public readonly idField: string
  public readonly capabilities = { supportsIncludes: true, supportsCreateManyReturn: true }

  private readonly fieldNames: Set<string>
  private readonly scope: TenantScope | null

  constructor(
    private readonly model: SeqModel,
    config: SequelizeAdapterConfig = {},
    scope: TenantScope | null = null
  ) {
    this.idField = config.idField ?? this.detectPk()
    this.scope = scope
    this.fields = SequelizeAdapter.fieldsFromModel(model, this.idField)
    this.fieldNames = new Set(this.fields.map((f) => f.name))
  }

  private detectPk(): string {
    for (const [name, attr] of Object.entries(this.model.rawAttributes)) {
      if (attr.primaryKey) return name
    }
    return 'id'
  }

  static fieldsFromModel(model: SeqModel, idField?: string): FieldDefinition[] {
    const pk =
      idField ?? Object.entries(model.rawAttributes).find(([, a]) => a.primaryKey)?.[0] ?? 'id'
    return Object.entries(model.rawAttributes).map(([name, attr]) => ({
      name,
      filterable: true,
      sortable: true,
      selectable: true,
      writable: name !== pk,
      ...seqTypeToFieldType(attr)
    }))
  }

  /** Only Postgres and MSSQL support `RETURNING` on UPDATE. */
  private get supportsReturning(): boolean {
    const d = this.model.sequelize?.getDialect()
    return d === 'postgres' || d === 'mssql'
  }

  private withScopeWhere(inner?: object): object | undefined {
    if (!this.scope) return inner
    const cond: Record<string, unknown> = { [this.scope.field]: this.scope.value }
    if (!inner) return cond
    return { [Op.and]: [cond, inner] }
  }

  private stripScope(data: Record<string, unknown>): Record<string, unknown> {
    if (!this.scope) return data
    const { [this.scope.field]: _ignored, ...rest } = data
    return rest
  }

  private toRecord(instance: SeqInstance | null | undefined): TRecord | null {
    return instance ? (instance.toJSON() as unknown as TRecord) : null
  }

  async getOne(
    id: string | number,
    options?: Pick<ListOptions, 'fields' | 'include'>
  ): Promise<TRecord | null> {
    const where = this.withScopeWhere({ [this.idField]: id })
    return this.toRecord(
      await this.model.findOne({
        where,
        attributes: options?.fields?.length ? options.fields : undefined,
        include: options?.include?.length ? (options.include as unknown[]) : undefined
      })
    )
  }

  async getMany(options?: ListOptions): Promise<ListResult<TRecord>> {
    const simpleWhere = options?.where
      ? Object.fromEntries(Object.entries(options.where).filter(([k]) => this.fieldNames.has(k)))
      : undefined
    const where = this.withScopeWhere(simpleWhere)
    const total = await this.model.count({ where })
    const order = options?.orderBy?.map(
      (s) => [s.field, s.direction.toUpperCase()] as [string, 'ASC' | 'DESC']
    )
    const rows = await this.model.findAll({
      where,
      attributes: options?.fields?.length ? options.fields : undefined,
      order,
      limit: options?.limit,
      offset: options?.offset,
      include: options?.include?.length ? (options.include as unknown[]) : undefined
    })
    return { count: total, results: rows.map((r) => r.toJSON() as unknown as TRecord) }
  }

  async createOne(data: TCreate): Promise<TRecord> {
    const values = this.scope
      ? { ...(data as Record<string, unknown>), [this.scope.field]: this.scope.value }
      : (data as Record<string, unknown>)
    try {
      return this.toRecord(await this.model.create(values)) as TRecord
    } catch (error) {
      if (isDuplicateError(error)) throw new ConflictError()
      throw error
    }
  }

  async createMany(data: TCreate[]): Promise<TRecord[]> {
    if (!data.length) return []
    const records = this.scope
      ? (data as Record<string, unknown>[]).map((d) => ({
          ...d,
          [this.scope!.field]: this.scope!.value
        }))
      : (data as Record<string, unknown>[])
    try {
      const rows = await this.model.bulkCreate(records)
      return rows.map((r) => r.toJSON() as unknown as TRecord)
    } catch (error) {
      if (isDuplicateError(error)) throw new ConflictError()
      throw error
    }
  }

  async updateOne(id: string | number, data: TUpdate): Promise<TRecord | null> {
    const where = this.withScopeWhere({ [this.idField]: id })
    const values = this.stripScope(data as Record<string, unknown>)
    try {
      if (this.supportsReturning) {
        const [, rows] = await this.model.update(values, { where, returning: true })
        return this.toRecord(rows?.[0])
      }
      const [affected] = await this.model.update(values, { where })
      if (affected === 0) return null
      return this.toRecord(await this.model.findOne({ where }))
    } catch (error) {
      if (isDuplicateError(error)) throw new ConflictError()
      throw error
    }
  }

  async upsertOne(id: string | number, data: TCreate & TUpdate): Promise<TRecord> {
    const existing = await this.getOne(id)
    if (existing) return (await this.updateOne(id, data as unknown as TUpdate)) as TRecord
    return this.createOne({ ...data, [this.idField]: id } as unknown as TCreate)
  }

  async updateMany(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>> {
    const filterWhere = astToSequelizeWhere(query.where, this.fieldNames)
    const where = this.withScopeWhere(filterWhere as object | undefined)
    const values = this.stripScope(data as Record<string, unknown>)
    const before = await this.model.findAll({ where, attributes: [this.idField] })
    const updated = before.map((r) => r.toJSON()[this.idField])
    await this.model.update(values, { where })
    const rows =
      updated.length > 0
        ? await this.model.findAll({ where: { [this.idField]: { [Op.in]: updated } } })
        : []
    return { updated, results: rows.map((r) => r.toJSON() as unknown as TRecord) }
  }

  async deleteOne(id: string | number): Promise<boolean> {
    const where = this.withScopeWhere({ [this.idField]: id })
    const affected = await this.model.destroy({ where })
    return affected > 0
  }

  async deleteMany(query: IQueryOptions): Promise<DeleteManyResult> {
    const filterWhere = astToSequelizeWhere(query.where, this.fieldNames)
    const where = this.withScopeWhere(filterWhere as object | undefined)
    const rows = await this.model.findAll({ where, attributes: [this.idField] })
    const deleted = rows.map((r) => r.toJSON()[this.idField])
    if (deleted.length > 0) await this.model.destroy({ where })
    return { deleted }
  }

  async executeQuery(query: IQueryOptions): Promise<QueryResult<TRecord>> {
    const filterWhere = astToSequelizeWhere(query.where, this.fieldNames)
    const where = this.withScopeWhere(filterWhere as object | undefined)
    const total = await this.model.count({ where })
    const order = astToSequelizeOrder(query.orderBy)
    const rows = await this.model.findAll({
      where,
      attributes: query.fields?.length ? query.fields : undefined,
      order,
      limit: query.limit,
      offset: query.offset
    })
    return { count: total, results: rows.map((r) => r.toJSON() as unknown as TRecord) }
  }

  withScope(scope: TenantScope): Repository<TRecord, TCreate, TUpdate> {
    return new SequelizeAdapter<TRecord, TCreate, TUpdate>(
      this.model,
      { idField: this.idField },
      scope
    )
  }
}
