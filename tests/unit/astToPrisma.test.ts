import { describe, it, expect } from 'vitest'
import { astToPrismaWhere, astToPrismaOrderBy } from '@/adapters/orm/prisma/astToPrisma.js'
import { SqlComparison } from '@edium/halifax-types'
import type { IQueryFilter } from '@edium/halifax-types'

describe('astToPrismaWhere — comparison mapping', () => {
  const one = (f: Partial<IQueryFilter>): unknown =>
    astToPrismaWhere([{ field: 'x', comparison: '=', ...f } as IQueryFilter])

  it('maps = / <> / >/>=/</<=', () => {
    expect(one({ comparison: '=', value1: 1 })).toEqual({ x: { equals: 1 } })
    expect(one({ comparison: '<>', value1: 1 })).toEqual({ x: { not: 1 } })
    expect(one({ comparison: '>', value1: 1 })).toEqual({ x: { gt: 1 } })
    expect(one({ comparison: '>=', value1: 1 })).toEqual({ x: { gte: 1 } })
    expect(one({ comparison: '<', value1: 1 })).toEqual({ x: { lt: 1 } })
    expect(one({ comparison: '<=', value1: 1 })).toEqual({ x: { lte: 1 } })
  })

  it('maps IN / NOT IN (and wraps a scalar in an array)', () => {
    expect(one({ comparison: 'IN', value1: [1, 2] })).toEqual({ x: { in: [1, 2] } })
    expect(one({ comparison: 'NOT IN', value1: [1] })).toEqual({ x: { notIn: [1] } })
    expect(one({ comparison: 'IN', value1: 3 })).toEqual({ x: { in: [3] } })
  })

  it('maps BETWEEN to gte+lte and NOT BETWEEN to an OR of lt/gt', () => {
    expect(one({ comparison: 'BETWEEN', value1: 1, value2: 9 })).toEqual({ x: { gte: 1, lte: 9 } })
    expect(one({ comparison: 'NOT BETWEEN', value1: 1, value2: 9 })).toEqual({
      OR: [{ x: { lt: 1 } }, { x: { gt: 9 } }]
    })
  })

  it('maps IS NULL / IS NOT NULL', () => {
    expect(one({ comparison: 'IS NULL' })).toEqual({ x: null })
    expect(one({ comparison: 'IS NOT NULL' })).toEqual({ x: { not: null } })
  })

  it('maps the portable string operators CONTAINS / STARTS WITH / ENDS WITH', () => {
    expect(one({ comparison: SqlComparison.Contains, value1: 'ab' })).toEqual({
      x: { contains: 'ab' }
    })
    expect(one({ comparison: SqlComparison.StartsWith, value1: 'ab' })).toEqual({
      x: { startsWith: 'ab' }
    })
    expect(one({ comparison: SqlComparison.EndsWith, value1: 'ab' })).toEqual({
      x: { endsWith: 'ab' }
    })
  })

  it('maps ICONTAINS / ISTARTS WITH / IENDS WITH to the string operators with mode: insensitive', () => {
    expect(one({ comparison: SqlComparison.IContains, value1: 'ab' })).toEqual({
      x: { contains: 'ab', mode: 'insensitive' }
    })
    expect(one({ comparison: SqlComparison.IStartsWith, value1: 'ab' })).toEqual({
      x: { startsWith: 'ab', mode: 'insensitive' }
    })
    expect(one({ comparison: SqlComparison.IEndsWith, value1: 'ab' })).toEqual({
      x: { endsWith: 'ab', mode: 'insensitive' }
    })
  })

  it('leaves mode out of the case-insensitive operators for providers that reject it', () => {
    const plain = (comparison: SqlComparison): unknown =>
      astToPrismaWhere([{ field: 'x', comparison, value1: 'ab' }], false)
    expect(plain(SqlComparison.IContains)).toEqual({ x: { contains: 'ab' } })
    expect(plain(SqlComparison.IStartsWith)).toEqual({ x: { startsWith: 'ab' } })
    expect(plain(SqlComparison.IEndsWith)).toEqual({ x: { endsWith: 'ab' } })
  })

  it('accepts the case-insensitive operators in lower case and carries the mode into children', () => {
    expect(
      astToPrismaWhere(
        [
          {
            field: 'a',
            comparison: 'icontains',
            value1: 'x',
            operator: 'OR',
            children: [{ field: 'b', comparison: SqlComparison.IContains, value1: 'y' }]
          }
        ],
        false
      )
    ).toEqual({ OR: [{ a: { contains: 'x' } }, { b: { contains: 'y' } }] })
  })

  it('translates LIKE wildcards into contains/startsWith/endsWith/equals', () => {
    expect(one({ comparison: 'LIKE', value1: '%ab%' })).toEqual({ x: { contains: 'ab' } })
    expect(one({ comparison: 'LIKE', value1: 'ab%' })).toEqual({ x: { startsWith: 'ab' } })
    expect(one({ comparison: 'LIKE', value1: '%ab' })).toEqual({ x: { endsWith: 'ab' } })
    expect(one({ comparison: 'LIKE', value1: 'ab' })).toEqual({ x: { equals: 'ab' } })
    expect(one({ comparison: 'NOT LIKE', value1: '%ab%' })).toEqual({
      NOT: { x: { contains: 'ab' } }
    })
  })
})

describe('astToPrismaWhere — logical precedence', () => {
  it('returns a bare condition for a single filter', () => {
    expect(astToPrismaWhere([{ field: 'a', comparison: '=', value1: 1 }])).toEqual({
      a: { equals: 1 }
    })
  })

  it('AND-joins a list with no OR operators', () => {
    expect(
      astToPrismaWhere([
        { field: 'a', comparison: '=', value1: 1, operator: 'AND' },
        { field: 'b', comparison: '=', value1: 2 }
      ])
    ).toEqual({ AND: [{ a: { equals: 1 } }, { b: { equals: 2 } }] })
  })

  it('splits AND-runs into OR groups (AND binds tighter than OR)', () => {
    // a AND b OR c  ->  (a AND b) OR c
    expect(
      astToPrismaWhere([
        { field: 'a', comparison: '=', value1: 1, operator: 'AND' },
        { field: 'b', comparison: '=', value1: 2, operator: 'OR' },
        { field: 'c', comparison: '=', value1: 3 }
      ])
    ).toEqual({
      OR: [{ AND: [{ a: { equals: 1 } }, { b: { equals: 2 } }] }, { c: { equals: 3 } }]
    })
  })

  it('AND-s a node with its nested children group', () => {
    expect(
      astToPrismaWhere([
        {
          field: 'a',
          comparison: '=',
          value1: 1,
          operator: 'AND',
          children: [{ field: 'b', comparison: '=', value1: 2 }]
        }
      ])
    ).toEqual({ AND: [{ a: { equals: 1 } }, { b: { equals: 2 } }] })
  })

  it('returns {} for an empty/undefined where', () => {
    expect(astToPrismaWhere()).toEqual({})
    expect(astToPrismaWhere([])).toEqual({})
  })
})

describe('astToPrismaOrderBy', () => {
  it('maps ASC/DESC (case-insensitively) to asc/desc', () => {
    expect(astToPrismaOrderBy([{ field: 'a', order: 'ASC' as never }])).toEqual([{ a: 'asc' }])
    expect(astToPrismaOrderBy([{ field: 'b', order: 'desc' as never }])).toEqual([{ b: 'desc' }])
  })

  it('returns undefined for empty input', () => {
    expect(astToPrismaOrderBy()).toBeUndefined()
    expect(astToPrismaOrderBy([])).toBeUndefined()
  })
})
