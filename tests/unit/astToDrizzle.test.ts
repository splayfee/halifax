/**
 * Direct unit tests for `astToDrizzleWhere` and `astToDrizzleOrderBy`.
 *
 * We use a tiny SQLite in-memory table to verify that the compiled SQL conditions
 * actually filter rows correctly — this is more robust than inspecting Drizzle's
 * internal SQL AST objects, which are opaque.
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { getTableColumns } from 'drizzle-orm'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { astToDrizzleWhere, astToDrizzleOrderBy } from '@/adapters/orm/drizzle/astToDrizzle.js'
import { SqlComparison, SqlOrder } from '@edium/halifax-types'
import type { IQueryFilter } from '@edium/halifax-types'

// ─── Schema ──────────────────────────────────────────────────────────────────

const items = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  score: integer('score').notNull().default(0),
  tag: text('tag')
})

type Item = { id: number; name: string; score: number; tag: string | null }

// ─── Fixtures ────────────────────────────────────────────────────────────────

let sqlite: InstanceType<typeof Database>
let db: ReturnType<typeof drizzle>
const cols = {} as ReturnType<typeof getTableColumns<typeof items>>

beforeAll(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE items (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      score  INTEGER NOT NULL DEFAULT 0,
      tag    TEXT
    )
  `)
  db = drizzle(sqlite)
  Object.assign(cols, getTableColumns(items))
})

afterAll(() => sqlite.close())

beforeEach(() => {
  db.delete(items).run()
  db.insert(items).values([
    { name: 'Alpha', score: 10, tag: 'a' },
    { name: 'Bravo', score: 20, tag: null },
    { name: 'Charlie', score: 30, tag: 'c' }
  ]).run()
})

// ─── Helper: run a where filter and return matching names ─────────────────────

function query(filter: IQueryFilter | IQueryFilter[]): string[] {
  const filters = Array.isArray(filter) ? filter : [filter]
  const where = astToDrizzleWhere(filters, cols)
  const rows = where
    ? db.select().from(items).where(where).all() as Item[]
    : db.select().from(items).all() as Item[]
  return rows.map((r) => r.name).sort()
}

// ─── Empty / undefined input ──────────────────────────────────────────────────

describe('astToDrizzleWhere — empty input', () => {
  it('returns undefined for undefined', () => {
    expect(astToDrizzleWhere(undefined, cols)).toBeUndefined()
  })

  it('returns undefined for empty array', () => {
    expect(astToDrizzleWhere([], cols)).toBeUndefined()
  })

  it('skips filters for unknown columns (returns undefined for that node)', () => {
    // When all nodes resolve to undefined the overall result is also undefined
    const result = astToDrizzleWhere([{ field: 'nonexistent', comparison: SqlComparison.Equal, value1: 'x' }], cols)
    expect(result).toBeUndefined()
  })
})

// ─── Comparison operators ─────────────────────────────────────────────────────

describe('astToDrizzleWhere — comparison operators', () => {
  it('NotEqual (<>)', () => {
    expect(query({ field: 'name', comparison: SqlComparison.NotEqual, value1: 'Alpha' })).toEqual(['Bravo', 'Charlie'])
  })

  it('GreaterThan (>)', () => {
    expect(query({ field: 'score', comparison: SqlComparison.GreaterThan, value1: 10 })).toEqual(['Bravo', 'Charlie'])
  })

  it('LessThan (<)', () => {
    expect(query({ field: 'score', comparison: SqlComparison.LessThan, value1: 30 })).toEqual(['Alpha', 'Bravo'])
  })

  it('LessThanOrEqual (<=)', () => {
    expect(query({ field: 'score', comparison: SqlComparison.LessThanOrEqual, value1: 20 })).toEqual(['Alpha', 'Bravo'])
  })

  it('Between (inclusive)', () => {
    expect(query({ field: 'score', comparison: SqlComparison.Between, value1: 10, value2: 20 })).toEqual(['Alpha', 'Bravo'])
  })

  it('NotBetween', () => {
    expect(query({ field: 'score', comparison: SqlComparison.NotBetween, value1: 15, value2: 25 })).toEqual(['Alpha', 'Charlie'])
  })

  it('NotIn', () => {
    expect(query({ field: 'name', comparison: SqlComparison.NotIn, value1: ['Alpha', 'Bravo'] })).toEqual(['Charlie'])
  })

  it('In with a scalar value (wraps it in array)', () => {
    // value1 is a scalar, not an array — adapter wraps it
    expect(query({ field: 'name', comparison: SqlComparison.In, value1: 'Bravo' as any })).toEqual(['Bravo'])
  })

  it('Like (raw SQL LIKE pattern)', () => {
    expect(query({ field: 'name', comparison: SqlComparison.Like, value1: 'Al%' })).toEqual(['Alpha'])
  })

  it('NotLike', () => {
    expect(query({ field: 'name', comparison: SqlComparison.NotLike, value1: 'Al%' })).toEqual(['Bravo', 'Charlie'])
  })

  it('StartsWith', () => {
    expect(query({ field: 'name', comparison: SqlComparison.StartsWith, value1: 'Br' })).toEqual(['Bravo'])
  })

  it('EndsWith', () => {
    expect(query({ field: 'name', comparison: SqlComparison.EndsWith, value1: 'ie' })).toEqual(['Charlie'])
  })

  it('default (unknown operator) falls back to Equal', () => {
    expect(query({ field: 'name', comparison: 'UNKNOWN_OP' as any, value1: 'Alpha' })).toEqual(['Alpha'])
  })
})

// ─── Children / nesting ───────────────────────────────────────────────────────

describe('astToDrizzleWhere — nesting', () => {
  it('parent AND children: all conditions must hold', () => {
    const result = query({
      field: 'score',
      comparison: SqlComparison.GreaterThan,
      value1: 5,
      children: [{ field: 'name', comparison: SqlComparison.Equal, value1: 'Alpha' }]
    })
    expect(result).toEqual(['Alpha'])
  })

  it('parent OR children: either branch matches', () => {
    const result = query({
      field: 'name',
      comparison: SqlComparison.Equal,
      value1: 'Alpha',
      operator: 'OR',
      children: [{ field: 'name', comparison: SqlComparison.Equal, value1: 'Bravo' }]
    })
    expect(result).toEqual(['Alpha', 'Bravo'])
  })

  it('children with no matching column are skipped (parent still applies)', () => {
    const result = query({
      field: 'name',
      comparison: SqlComparison.Equal,
      value1: 'Alpha',
      children: [{ field: 'MISSING', comparison: SqlComparison.Equal, value1: 'x' }]
    })
    // childWhere is undefined → returns self only
    expect(result).toEqual(['Alpha'])
  })
})

// ─── astToDrizzleOrderBy ─────────────────────────────────────────────────────

describe('astToDrizzleOrderBy', () => {
  it('returns empty array for undefined', () => {
    expect(astToDrizzleOrderBy(undefined, cols)).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(astToDrizzleOrderBy([], cols)).toEqual([])
  })

  it('sorts ascending when order is ASC', () => {
    const orderBy = astToDrizzleOrderBy([{ field: 'score', order: SqlOrder.ASC }], cols)
    const rows = db.select().from(items).orderBy(...orderBy).all() as Item[]
    expect(rows.map((r) => r.score)).toEqual([10, 20, 30])
  })

  it('sorts descending when order is DESC', () => {
    const orderBy = astToDrizzleOrderBy([{ field: 'score', order: SqlOrder.DESC }], cols)
    const rows = db.select().from(items).orderBy(...orderBy).all() as Item[]
    expect(rows.map((r) => r.score)).toEqual([30, 20, 10])
  })

  it('skips unknown fields', () => {
    const orderBy = astToDrizzleOrderBy([{ field: 'nonexistent', order: SqlOrder.ASC }], cols)
    expect(orderBy).toEqual([])
  })
})
