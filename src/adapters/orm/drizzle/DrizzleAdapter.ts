import { ConflictError } from '@/errors/ConflictError.js'
import { ServerError } from '@/errors/ServerError.js'
import { count, eq, getTableColumns, and, inArray, asc, desc } from 'drizzle-orm'
import type { AnyColumn, SQL, Table } from 'drizzle-orm'
import type { IQueryOptions, QueryScalar } from '@edium/halifax-types'
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
import { astToDrizzleWhere, astToDrizzleOrderBy, type ColumnMap } from './astToDrizzle.js'

// Drizzle doesn't export a single unified DB type across all drivers.
// These structural interfaces cover the common query-builder surface all drivers share.
//
// `returning()` is optional here — MySQL/MariaDB drivers don't expose it (MySQL has no
// native RETURNING clause). Callers check `this.dialect === 'mysql'` and use alternate
// paths. Chains extend PromiseLike so they can be `await`ed directly for those paths.

type DrizzleOrderByArg = SQL | AnyColumn | ((aliases: Record<string, AnyColumn>) => unknown)

interface DrizzleDynamicSelect extends PromiseLike<unknown[]> {
  where(cond?: SQL): DrizzleDynamicSelect
  orderBy(...cols: DrizzleOrderByArg[]): DrizzleDynamicSelect
  limit(n: number): DrizzleDynamicSelect
  offset(n: number): DrizzleDynamicSelect
}

interface DrizzleSelectBuilder extends PromiseLike<unknown[]> {
  $dynamic(): DrizzleDynamicSelect
  where(cond?: SQL): PromiseLike<unknown[]>
}

interface DrizzleFromChain {
  from(table: Table): DrizzleSelectBuilder
}

interface DrizzleInsertValuesChain extends PromiseLike<unknown> {
  returning?(): Promise<unknown[]>
}

interface DrizzleInsertChain {
  values(data: unknown): DrizzleInsertValuesChain
}

interface DrizzleUpdateWhereChain extends PromiseLike<unknown> {
  returning?(): Promise<unknown[]>
}

interface DrizzleUpdateSetChain {
  where(cond?: SQL): DrizzleUpdateWhereChain
}

interface DrizzleUpdateChain {
  set(data: Record<string, unknown>): DrizzleUpdateSetChain
}

interface DrizzleDeleteWhereChain extends PromiseLike<unknown> {
  returning?(): Promise<unknown[]>
}

interface DrizzleDeleteChain {
  where(cond?: SQL): DrizzleDeleteWhereChain
}

export interface AnyDrizzleDB {
  select(fields?: Record<string, AnyColumn | SQL>): DrizzleFromChain
  insert(table: Table): DrizzleInsertChain
  update(table: Table): DrizzleUpdateChain
  delete(table: Table): DrizzleDeleteChain
}

export interface DrizzleAdapterConfig {
  /**
   * Primary-key field name. Defaults to auto-detecting the first column with `.primaryKey()`.
   * Set explicitly when using composite PKs or a non-standard naming convention.
   */
  idField?: string
  /**
   * SQL dialect. Defaults to `'postgres'` (also correct for SQLite and CockroachDB).
   * Set to `'mysql'` when connecting via drizzle-orm/mysql2 — this disables the `.returning()`
   * path on writes and uses a SELECT round-trip instead, since MySQL has no native RETURNING.
   */
  dialect?: 'postgres' | 'mysql' | 'sqlite'
}

/** Detects unique constraint violations across PostgreSQL (23505), MySQL (1062/ER_DUP_ENTRY), and SQLite. */
function isDuplicateError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as Record<string, unknown>
  if (e['code'] === '23505') return true
  if (e['errno'] === 1062 || e['code'] === 'ER_DUP_ENTRY') return true
  if (typeof e['message'] === 'string' && e['message'].includes('UNIQUE constraint failed'))
    return true
  return false
}

function drizzleTypeToOpenApi(col: AnyColumn): { type?: FieldType; format?: string } {
  switch ((col as { dataType?: string }).dataType) {
    case 'string':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'bigint':
      return { type: 'integer', format: 'int64' }
    case 'date':
      return { type: 'string', format: 'date-time' }
    case 'json':
      return { type: 'object' }
    case 'buffer':
      return { type: 'string', format: 'binary' }
    default:
      return {}
  }
}

/**
 * Drizzle ORM repository adapter for `@edium/halifax`.
 *
 * Supports PostgreSQL, SQLite, and CockroachDB (use default `dialect: 'postgres'`) as well as
 * MySQL and MariaDB (`dialect: 'mysql'`). MySQL lacks a native RETURNING clause, so write
 * operations use an extra SELECT round-trip instead of the single-query RETURNING path.
 *
 * Relations / `?include=` are not supported — `capabilities.supportsIncludes` is `false`.
 * Use `PrismaAdapter` for resources that need eager relation loading.
 */
export class DrizzleAdapter<
  TRecord = Record<string, unknown>,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> implements Repository<TRecord, TCreate, TUpdate> {
  public readonly fields: FieldDefinition[]
  public readonly idField: string
  /** Drizzle uses `.returning()` for postgres/sqlite and a re-fetch for mysql. */
  public readonly capabilities = { supportsIncludes: false, supportsCreateManyReturn: true }

  private readonly columns: ColumnMap
  private readonly scope: TenantScope | null
  private readonly dialect: 'postgres' | 'mysql' | 'sqlite'

  constructor(
    private readonly db: AnyDrizzleDB,
    private readonly table: Table,
    config: DrizzleAdapterConfig = {},
    scope: TenantScope | null = null
  ) {
    this.columns = getTableColumns(table) as ColumnMap
    this.idField = config.idField ?? this.detectPrimaryKey()
    this.dialect = config.dialect ?? 'postgres'
    this.fields = DrizzleAdapter.fieldsFromTable(table, this.idField)
    this.scope = scope
  }

  private detectPrimaryKey(): string {
    for (const [name, col] of Object.entries(this.columns)) {
      if ((col as { primary?: boolean }).primary) return name
    }
    return 'id'
  }

  static fieldsFromTable(table: Table, idField?: string): FieldDefinition[] {
    const cols = getTableColumns(table) as ColumnMap
    const pkField =
      idField ??
      Object.entries(cols).find(([, c]) => (c as { primary?: boolean }).primary)?.[0] ??
      'id'
    return Object.entries(cols).map(([name, col]) => ({
      name,
      filterable: true,
      sortable: true,
      selectable: true,
      writable: name !== pkField,
      ...drizzleTypeToOpenApi(col)
    }))
  }

  private buildSelect(fields?: string[]): DrizzleDynamicSelect {
    if (fields?.length) {
      const sel: Record<string, AnyColumn> = {}
      for (const f of fields) {
        if (this.columns[f]) sel[f] = this.columns[f]!
      }
      return this.db.select(sel).from(this.table).$dynamic()
    }
    return this.db.select().from(this.table).$dynamic()
  }

  private listWhereToSQL(where?: Record<string, unknown>): SQL | undefined {
    if (!where || !Object.keys(where).length) return undefined
    const conditions = Object.entries(where)
      .filter(([k]) => this.columns[k])
      .map(([k, v]) => {
        const col = this.columns[k]!
        if (v === null) return eq(col, null as unknown as QueryScalar)
        if (typeof v === 'object' && v !== null && 'in' in v) {
          return inArray(col, (v as { in: QueryScalar[] }).in)
        }
        return eq(col, v as QueryScalar)
      })
    if (!conditions.length) return undefined
    return conditions.length === 1 ? conditions[0] : and(...conditions)
  }

  private withScopeWhere(inner?: SQL): SQL | undefined {
    if (!this.scope) return inner
    const col = this.columns[this.scope.field]
    if (!col) return inner
    const scopeEq = eq(col, this.scope.value as QueryScalar)
    if (!inner) return scopeEq
    return and(scopeEq, inner)
  }

  private stripScope(data: Record<string, unknown>): Record<string, unknown> {
    if (!this.scope) return data
    const { [this.scope.field]: _ignored, ...rest } = data
    return rest
  }

  async getOne(
    id: string | number,
    options?: Pick<ListOptions, 'fields' | 'include'>
  ): Promise<TRecord | null> {
    const idWhere = eq(this.columns[this.idField]!, id as QueryScalar)
    const where = this.withScopeWhere(idWhere)
    const rows = (await this.buildSelect(options?.fields).where(where)) as (TRecord | undefined)[]
    return rows[0] ?? null
  }

  async getMany(options?: ListOptions): Promise<ListResult<TRecord>> {
    const filterWhere = this.listWhereToSQL(options?.where)
    const where = this.withScopeWhere(filterWhere)

    const countResult = (await this.db
      .select({ count: count() })
      .from(this.table)
      .where(where)) as [{ count: string | number }?]
    const total = Number(countResult[0]?.count ?? 0)

    let query = this.buildSelect(options?.fields).where(where)
    if (options?.orderBy?.length) {
      const sorts = options.orderBy
        .filter((s) => this.columns[s.field])
        .map((s) => {
          const col = this.columns[s.field]!
          return s.direction === 'desc' ? desc(col) : asc(col)
        })
      if (sorts.length) query = query.orderBy(...sorts)
    }
    if (options?.limit != null) query = query.limit(options.limit)
    if (options?.offset != null) query = query.offset(options.offset)

    const rows = (await query) as TRecord[]
    return { count: total, results: rows }
  }

  async createOne(data: TCreate): Promise<TRecord> {
    const stamped = this.scope
      ? { ...(data as Record<string, unknown>), [this.scope.field]: this.scope.value }
      : data
    try {
      if (this.dialect === 'mysql') {
        return await this.createOneMysql(stamped as Record<string, unknown>)
      }
      const chain = this.db.insert(this.table).values(stamped)
      const rows = (await chain.returning!()) as (TRecord | undefined)[]
      return rows[0] as TRecord
    } catch (error) {
      if (isDuplicateError(error)) throw new ConflictError()
      throw error
    }
  }

  private async createOneMysql(stamped: Record<string, unknown>): Promise<TRecord> {
    // MySQL has no RETURNING — insert then re-fetch by inserted ID.
    const raw = await (this.db.insert(this.table).values(stamped) as unknown as Promise<
      [{ insertId?: number | bigint }, unknown]
    >)
    const providedId = stamped[this.idField]
    const autoId = raw[0]?.insertId != null ? Number(raw[0].insertId) : 0
    const insertedId = providedId ?? (autoId > 0 ? autoId : undefined)
    if (insertedId == null) {
      throw new ServerError(
        'MySQL createOne: cannot determine inserted row ID. Use an auto-increment PK or provide the id in the data.'
      )
    }
    const rows = (await this.buildSelect().where(
      eq(this.columns[this.idField]!, insertedId as QueryScalar)
    )) as TRecord[]
    if (!rows[0]) throw new ServerError('MySQL createOne: row not found after insert')
    return rows[0]
  }

  async createMany(data: TCreate[]): Promise<TRecord[]> {
    if (!data.length) return []
    if (this.dialect === 'mysql') {
      // Serial createOne — avoids insertId arithmetic for non-auto-increment PKs.
      return await Promise.all(data.map((item) => this.createOne(item)))
    }
    const stamped = this.scope
      ? data.map((d) => ({
          ...(d as Record<string, unknown>),
          [this.scope!.field]: this.scope!.value
        }))
      : data
    try {
      const rows = (await this.db.insert(this.table).values(stamped).returning!()) as TRecord[]
      return rows
    } catch (error) {
      if (isDuplicateError(error)) throw new ConflictError()
      throw error
    }
  }

  async updateOne(id: string | number, data: TUpdate): Promise<TRecord | null> {
    const idWhere = eq(this.columns[this.idField]!, id as QueryScalar)
    const where = this.withScopeWhere(idWhere)
    const cleanData = this.stripScope(data as Record<string, unknown>)
    try {
      if (this.dialect === 'mysql') {
        await (this.db
          .update(this.table)
          .set(cleanData)
          .where(where) as unknown as Promise<unknown>)
        const rows = (await this.buildSelect().where(where)) as (TRecord | undefined)[]
        return rows[0] ?? null
      }
      const rows = (await this.db.update(this.table).set(cleanData).where(where).returning!()) as (
        | TRecord
        | undefined
      )[]
      return rows[0] ?? null
    } catch (error) {
      if (isDuplicateError(error)) throw new ConflictError()
      throw error
    }
  }

  async upsertOne(id: string | number, data: TCreate & TUpdate): Promise<TRecord> {
    // Non-atomic check-then-write. Concurrent upserts for the same absent ID may race on
    // createOne and get a ConflictError. Use a DB-specific ON CONFLICT clause for true atomicity.
    const existing = await this.getOne(id)
    if (existing) {
      const updated = await this.updateOne(id, data as unknown as TUpdate)
      return updated as TRecord
    }
    return this.createOne({ ...data, [this.idField]: id } as unknown as TCreate)
  }

  async updateMany(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>> {
    const where = this.withScopeWhere(astToDrizzleWhere(query.where, this.columns))
    const cleanData = this.stripScope(data as Record<string, unknown>)

    if (this.dialect === 'mysql') {
      const before = (await this.buildSelect([this.idField]).where(where)) as Record<
        string,
        unknown
      >[]
      const ids = before.map((r) => r[this.idField])
      await (this.db.update(this.table).set(cleanData).where(where) as unknown as Promise<unknown>)
      const results =
        ids.length > 0
          ? ((await this.buildSelect().where(
              inArray(this.columns[this.idField]!, ids as QueryScalar[])
            )) as TRecord[])
          : []
      return { updated: ids, results }
    }

    const rows = (await this.db.update(this.table).set(cleanData).where(where)
      .returning!()) as TRecord[]
    const ids = (rows as Record<string, unknown>[]).map((r) => r[this.idField])
    return { updated: ids, results: rows }
  }

  async deleteOne(id: string | number): Promise<boolean> {
    const idWhere = eq(this.columns[this.idField]!, id as QueryScalar)
    const where = this.withScopeWhere(idWhere)

    if (this.dialect === 'mysql') {
      // Use affectedRows from the DELETE result — avoids an extra SELECT round-trip.
      const raw = await (this.db.delete(this.table).where(where) as unknown as Promise<
        [{ affectedRows?: number }, unknown]
      >)
      return (raw[0]?.affectedRows ?? 0) > 0
    }

    const rows = await this.db.delete(this.table).where(where).returning!()
    return rows.length > 0
  }

  async deleteMany(query: IQueryOptions): Promise<DeleteManyResult> {
    const where = this.withScopeWhere(astToDrizzleWhere(query.where, this.columns))

    if (this.dialect === 'mysql') {
      const rows = (await this.buildSelect([this.idField]).where(where)) as Record<
        string,
        unknown
      >[]
      const deleted = rows.map((r) => r[this.idField])
      if (deleted.length > 0) {
        await (this.db.delete(this.table).where(where) as unknown as Promise<unknown>)
      }
      return { deleted }
    }

    const rows = (await this.db.delete(this.table).where(where).returning!()) as Record<
      string,
      unknown
    >[]
    const deleted = rows.map((r) => r[this.idField])
    return { deleted }
  }

  async executeQuery(query: IQueryOptions): Promise<QueryResult<TRecord>> {
    const where = this.withScopeWhere(astToDrizzleWhere(query.where, this.columns))

    const countResult = (await this.db
      .select({ count: count() })
      .from(this.table)
      .where(where)) as [{ count: string | number }?]
    const total = Number(countResult[0]?.count ?? 0)

    const sorts = astToDrizzleOrderBy(query.orderBy, this.columns)
    let q = this.buildSelect(query.fields).where(where)
    if (sorts.length) q = q.orderBy(...sorts)
    if (query.limit != null) q = q.limit(query.limit)
    if (query.offset != null) q = q.offset(query.offset)

    const rows = (await q) as TRecord[]
    return { count: total, results: rows }
  }

  withScope(scope: TenantScope): Repository<TRecord, TCreate, TUpdate> {
    return new DrizzleAdapter<TRecord, TCreate, TUpdate>(
      this.db,
      this.table,
      { idField: this.idField, dialect: this.dialect },
      scope
    )
  }
}
