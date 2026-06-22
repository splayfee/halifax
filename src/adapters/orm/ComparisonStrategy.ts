import type { IQueryFilter, QueryScalar } from '@edium/halifax-types'
import { SqlComparison } from '@edium/halifax-types'

/**
 * GoF **Strategy** pattern: each SQL comparison operator is an interchangeable algorithm
 * (a {@link ComparisonStrategy}) that builds a backend-specific predicate. An adapter registers a
 * full {@link ComparisonStrategyTable} of these, and {@link buildComparison} selects the right one
 * per filter at runtime. The dispatch/normalization logic lives here once; adapters supply only the
 * per-operator strategies — so Prisma and Drizzle stay behaviourally in lockstep.
 */

/** The two operands of a comparison filter, handed to a {@link ComparisonStrategy}. */
export interface ComparisonOperands {
  /** Primary value (the right-hand side of most comparisons; the lower bound of `BETWEEN`). */
  v1: QueryScalar | QueryScalar[] | undefined
  /** Secondary value — only used by `BETWEEN` / `NOT BETWEEN` (the upper bound). */
  v2: QueryScalar | QueryScalar[] | undefined
}

/**
 * One concrete Strategy: builds a backend-specific predicate (`T`) for a target column/field (`C`)
 * and the filter's operands. Prisma uses `C = field name (string)` → `T = where fragment`; Drizzle
 * uses `C = column` → `T = SQL`.
 */
export type ComparisonStrategy<T, C> = (target: C, operands: ComparisonOperands) => T

/**
 * A per-adapter map from **every** SQL comparison operator to its {@link ComparisonStrategy}. Using
 * a total `Record` (not `Partial`) makes the compiler enforce that an adapter handles all 17
 * operators — adding one to {@link SqlComparison} breaks the build until each adapter maps it.
 */
export type ComparisonStrategyTable<T, C> = Record<SqlComparison, ComparisonStrategy<T, C>>

/**
 * Normalizes a filter's comparison operator and dispatches to the matching strategy in `table`,
 * falling back to the `Equal` strategy for an absent/blank operator. Centralizing the
 * uppercase-normalization and fallback here is what keeps every ORM adapter in lockstep — each
 * adapter supplies only its backend-specific strategies, never the control flow.
 *
 * @param filter - The filter whose `comparison`, `value1`, and `value2` drive the predicate.
 * @param target - The backend target the strategy needs (a field name for Prisma, a column for Drizzle).
 * @param table - The adapter's operator → strategy map.
 * @returns The backend-specific predicate produced by the selected strategy.
 */
export function buildComparison<T, C>(
  filter: IQueryFilter,
  target: C,
  table: ComparisonStrategyTable<T, C>
): T {
  const comparison = (filter.comparison?.toUpperCase() ?? '=') as SqlComparison
  const strategy = table[comparison] ?? table[SqlComparison.Equal]
  return strategy(target, { v1: filter.value1, v2: filter.value2 })
}
