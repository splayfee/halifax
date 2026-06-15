import { SqlComparison, SqlOperator, SqlOrder } from '@edium/halifax-types'
import type { IQueryFilter, QueryScalar, IQueryOptions, ISort } from '@edium/halifax-types'

/**
 * Fluent builder for Halifax query-AST (`IQueryOptions`).
 *
 * **Mutability note:** all chaining methods mutate `this` and return `this`.
 * Do not share a builder instance across branches — instead create a new
 * `QueryBuilder` for each independent query:
 * ```ts
 * // WRONG — both calls mutate the same builder
 * const base = new QueryBuilder().where('active', '=', true)
 * const p1 = base.limit(10)   // mutates base
 * const p2 = base.limit(20)   // also mutates base; p1.limit is now 20
 *
 * // CORRECT
 * const p1 = new QueryBuilder().where('active', '=', true).limit(10)
 * const p2 = new QueryBuilder().where('active', '=', true).limit(20)
 * ```
 */
export class QueryBuilder {
  private readonly _where: IQueryFilter[] = []
  private _limit?: number
  private _offset?: number
  private readonly _orderBy: ISort[] = []
  private _fields?: string[]
  private _distinct?: string[]

  private get _last(): IQueryFilter | undefined {
    return this._where[this._where.length - 1]
  }

  private push(
    field: string,
    comparison: SqlComparison | string,
    value1?: QueryScalar | QueryScalar[],
    value2?: string | number,
    children?: IQueryFilter[]
  ): IQueryFilter {
    const filter: IQueryFilter = { field, comparison }
    if (value1 !== undefined) filter.value1 = value1
    if (value2 !== undefined) filter.value2 = value2
    if (children?.length) filter.children = children
    this._where.push(filter)
    return filter
  }

  /**
   * Add the first (or only) WHERE condition. Subsequent conditions use `.and()` or `.or()`.
   */
  where(
    field: string,
    comparison: SqlComparison | string,
    value1?: QueryScalar | QueryScalar[],
    value2?: string | number
  ): this {
    this.push(field, comparison, value1, value2)
    return this
  }

  /**
   * Append a condition joined to the previous one with AND.
   * `a.and(b)` → `a AND b`
   */
  and(
    field: string,
    comparison: SqlComparison | string,
    value1?: QueryScalar | QueryScalar[],
    value2?: string | number
  ): this {
    if (this._last && !this._last.children) this._last.operator = SqlOperator.And
    this.push(field, comparison, value1, value2)
    return this
  }

  /**
   * Append a condition joined to the previous one with OR.
   * `a.or(b)` → `a OR b`
   * Note: AND binds tighter than OR — `a AND b OR c` groups as `(a AND b) OR c`.
   */
  or(
    field: string,
    comparison: SqlComparison | string,
    value1?: QueryScalar | QueryScalar[],
    value2?: string | number
  ): this {
    if (this._last && !this._last.children) this._last.operator = SqlOperator.Or
    this.push(field, comparison, value1, value2)
    return this
  }

  /**
   * Add a parenthesized sub-group joined to the preceding condition with AND.
   *
   * **Why a `field`/`comparison`/`value1` is required:** the Halifax query AST attaches
   * children to a *parent filter node*, so every group must carry its own condition that
   * is AND-ed with the group's children. To express a pure group with no parent condition,
   * pass `SqlComparison.IsNotNull` with `value1 = undefined` for a field you know is
   * always populated (e.g. the primary-key field) — the parent check is trivially true
   * and the effective predicate is just the parenthesised children.
   *
   * The result is: `…preceding… AND (field op value1 AND (children))`.
   *
   * @example
   * // WHERE status = 'active' AND (role = 'admin' OR role = 'user')
   * new QueryBuilder()
   *   .where('status', SqlComparison.Equal, 'active')
   *   .andGroup('role', SqlComparison.Equal, 'admin', (b) =>
   *     b.or('role', SqlComparison.Equal, 'user')
   *   )
   */
  andGroup(
    field: string,
    comparison: SqlComparison | string,
    value1: QueryScalar | undefined,
    fn: (b: QueryBuilder) => void
  ): this {
    if (this._last && !this._last.children) this._last.operator = SqlOperator.And
    const child = new QueryBuilder()
    fn(child)
    const filter = this.push(field, comparison, value1 ?? undefined, undefined, child._where)
    filter.operator = SqlOperator.And
    return this
  }

  /**
   * Add a parenthesized sub-group whose *children* are joined to the parent with OR.
   *
   * **Why a `field`/`comparison`/`value1` is required:** same AST constraint as
   * {@link andGroup} — every group node must carry a parent condition. The group is
   * connected to any preceding sibling with AND (the `orGroup` name describes the
   * *internal* OR join between the parent condition and the children, not the join to
   * the rest of the clause).
   *
   * The result is: `…preceding… AND (field op value1 OR (children))`.
   *
   * @example
   * // WHERE type = 'post' AND (name CONTAINS 'foo' OR body CONTAINS 'foo')
   * new QueryBuilder()
   *   .where('type', SqlComparison.Equal, 'post')
   *   .orGroup('name', SqlComparison.Contains, 'foo', (b) =>
   *     b.or('body', SqlComparison.Contains, 'foo')
   *   )
   */
  orGroup(
    field: string,
    comparison: SqlComparison | string,
    value1: QueryScalar | undefined,
    fn: (b: QueryBuilder) => void
  ): this {
    if (this._last && !this._last.children) this._last.operator = SqlOperator.And
    const child = new QueryBuilder()
    fn(child)
    const filter = this.push(field, comparison, value1 ?? undefined, undefined, child._where)
    filter.operator = SqlOperator.Or
    return this
  }

  /** Maximum records to return. */
  limit(n: number): this {
    this._limit = n
    return this
  }

  /** Records to skip for pagination. */
  offset(n: number): this {
    this._offset = n
    return this
  }

  /** Add an ORDER BY expression. Defaults to ASC. */
  orderBy(field: string, direction: SqlOrder = SqlOrder.ASC): this {
    this._orderBy.push({ field, order: direction })
    return this
  }

  /** Project specific fields (mutually exclusive with includes on the server). */
  select(...fields: string[]): this {
    this._fields = fields
    return this
  }

  /** Return only distinct rows on these columns. */
  distinct(...fields: string[]): this {
    this._distinct = fields
    return this
  }

  /** Produce the IQueryOptions AST to send to the server. */
  build(): IQueryOptions {
    const result: IQueryOptions = {}
    if (this._where.length) result.where = [...this._where]
    if (this._limit !== undefined) result.limit = this._limit
    if (this._offset !== undefined) result.offset = this._offset
    if (this._orderBy.length) result.orderBy = [...this._orderBy]
    if (this._fields?.length) result.fields = [...this._fields]
    if (this._distinct?.length) result.distinct = [...this._distinct]
    return result
  }
}

// Re-export enums so callers don't need separate imports when building queries.
export { SqlComparison, SqlOperator, SqlOrder }
export type { IQueryOptions, IQueryFilter, ISort, QueryScalar }
