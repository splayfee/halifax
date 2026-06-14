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
// This structural interface covers the common query-builder surface all drivers share.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDrizzleDB = any

export interface DrizzleAdapterConfig {
  /**
   * Primary-key field name. Defaults to auto-detecting the first column with `.primaryKey()`.
   * Set explicitly when using composite PKs or a non-standard naming convention.
   */
  idField?: string
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
 * Install `drizzle-orm` as a peer dependency alongside your preferred Drizzle driver
 * (`drizzle-orm/better-sqlite3`, `drizzle-orm/postgres-js`, `drizzle-orm/mysql2`, etc.)
 * then pass the `db` instance and your table schema:
 *
 * ```ts
 * import { DrizzleAdapter } from '@edium/halifax/drizzle'
 * import { drizzle } from 'drizzle-orm/postgres-js'
 * import postgres from 'postgres'
 * import { usersTable } from './schema'
 *
 * const db = drizzle(postgres(process.env.DATABASE_URL!))
 *
 * const usersResource: ResourceDefinition = {
 *   routePrefix: 'users',
 *   repository: new DrizzleAdapter(db, usersTable),
 * }
 * ```
 *
 * Field schema and types are inferred automatically from the Drizzle table definition.
 * Multi-tenant isolation via `withScope()` and the advanced query builder via
 * `executeQuery()` are both supported.
 *
 * @template TRecord - Shape of the records returned from the database.
 * @template TCreate - Shape of the data used for inserts (defaults to `Partial<TRecord>`).
 * @template TUpdate - Shape of the data used for updates (defaults to `Partial<TRecord>`).
 */
export class DrizzleAdapter<
  TRecord = Record<string, unknown>,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> implements Repository<TRecord, TCreate, TUpdate>
{
  public readonly fields: FieldDefinition[]
  public readonly idField: string

  private readonly columns: ColumnMap
  private readonly scope: TenantScope | null

  constructor(
    private readonly db: AnyDrizzleDB,
    private readonly table: Table,
    config: DrizzleAdapterConfig = {},
    scope: TenantScope | null = null
  ) {
    this.columns = getTableColumns(table) as ColumnMap
    this.idField = config.idField ?? this.detectPrimaryKey()
    this.fields = DrizzleAdapter.fieldsFromTable(table, this.idField)
    this.scope = scope
  }

  private detectPrimaryKey(): string {
    for (const [name, col] of Object.entries(this.columns)) {
      if ((col as { primary?: boolean }).primary) return name
    }
    return 'id'
  }

  /**
   * Derives a Halifax field schema from a Drizzle table definition.
   * Column types are mapped to their OpenAPI equivalents automatically.
   * @param table - The Drizzle table schema.
   * @param idField - The primary-key field name (auto-detected when omitted).
   * @returns The resolved field definition list.
   */
  static fieldsFromTable(table: Table, idField?: string): FieldDefinition[] {
    const cols = getTableColumns(table) as ColumnMap
    const pkField = idField ?? Object.entries(cols).find(([, c]) => (c as { primary?: boolean }).primary)?.[0] ?? 'id'
    return Object.entries(cols).map(([name, col]) => ({
      name,
      filterable: true,
      sortable: true,
      selectable: true,
      writable: name !== pkField,
      ...drizzleTypeToOpenApi(col)
    }))
  }

  private buildSelect(fields?: string[]): AnyDrizzleDB {
    if (fields?.length) {
      const sel: Record<string, AnyColumn> = {}
      for (const f of fields) {
        if (this.columns[f]) sel[f] = this.columns[f]!
      }
      return this.db.select(sel)
    }
    return this.db.select()
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
    const rows = await this.buildSelect(options?.fields).from(this.table).where(where)
    return (rows[0] ?? null) as TRecord | null
  }

  async getMany(options?: ListOptions): Promise<ListResult<TRecord>> {
    const filterWhere = this.listWhereToSQL(options?.where)
    const where = this.withScopeWhere(filterWhere)

    const countResult = await this.db.select({ count: count() }).from(this.table).where(where)
    const total = Number(countResult[0]?.count ?? 0)

    let query = this.buildSelect(options?.fields).from(this.table).where(where)
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

    const rows = await query
    return { count: total, results: rows as TRecord[] }
  }

  async createOne(data: TCreate, _options?: { idempotencyKey?: string }): Promise<TRecord> {
    const rows = await this.db
      .insert(this.table)
      .values(this.scope ? { ...data, [this.scope.field]: this.scope.value } : data)
      .returning()
    return rows[0] as TRecord
  }

  async createMany(data: TCreate[], _options?: { idempotencyKey?: string }): Promise<TRecord[]> {
    if (!data.length) return []
    const stamped = this.scope
      ? data.map((d) => ({ ...d, [this.scope!.field]: this.scope!.value }))
      : data
    const rows = await this.db.insert(this.table).values(stamped).returning()
    return rows as TRecord[]
  }

  async updateOne(id: string | number, data: TUpdate): Promise<TRecord | null> {
    const idWhere = eq(this.columns[this.idField]!, id as QueryScalar)
    const where = this.withScopeWhere(idWhere)
    const rows = await this.db
      .update(this.table)
      .set(this.stripScope(data as Record<string, unknown>))
      .where(where)
      .returning()
    return (rows[0] ?? null) as TRecord | null
  }

  async upsertOne(id: string | number, data: TCreate & TUpdate): Promise<TRecord> {
    const existing = await this.getOne(id)
    if (existing) {
      const updated = await this.updateOne(id, data as unknown as TUpdate)
      return updated as TRecord
    }
    return this.createOne({ ...data, [this.idField]: id } as unknown as TCreate)
  }

  async updateMany(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>> {
    const where = this.withScopeWhere(astToDrizzleWhere(query.where, this.columns))
    const rows = await this.db
      .update(this.table)
      .set(this.stripScope(data as Record<string, unknown>))
      .where(where)
      .returning()
    const ids = rows.map((r: Record<string, unknown>) => r[this.idField])
    return { updated: ids, results: rows as TRecord[] }
  }

  async deleteOne(id: string | number): Promise<boolean> {
    const idWhere = eq(this.columns[this.idField]!, id as QueryScalar)
    const where = this.withScopeWhere(idWhere)
    const rows = await this.db.delete(this.table).where(where).returning()
    return rows.length > 0
  }

  async deleteMany(query: IQueryOptions): Promise<DeleteManyResult> {
    const where = this.withScopeWhere(astToDrizzleWhere(query.where, this.columns))
    const rows = await this.db.delete(this.table).where(where).returning()
    const deleted = rows.map((r: Record<string, unknown>) => r[this.idField])
    return { deleted }
  }

  async executeQuery(query: IQueryOptions): Promise<QueryResult<TRecord>> {
    const where = this.withScopeWhere(astToDrizzleWhere(query.where, this.columns))

    const countResult = await this.db.select({ count: count() }).from(this.table).where(where)
    const total = Number(countResult[0]?.count ?? 0)

    const sorts = astToDrizzleOrderBy(query.orderBy, this.columns)
    let q = this.buildSelect(query.fields).from(this.table).where(where)
    if (sorts.length) q = q.orderBy(...sorts)
    if (query.limit != null) q = q.limit(query.limit)
    if (query.offset != null) q = q.offset(query.offset)

    const rows = await q
    return { count: total, results: rows as TRecord[] }
  }

  withScope(scope: TenantScope): Repository<TRecord, TCreate, TUpdate> {
    return new DrizzleAdapter<TRecord, TCreate, TUpdate>(this.db, this.table, { idField: this.idField }, scope ?? null)
  }
}
