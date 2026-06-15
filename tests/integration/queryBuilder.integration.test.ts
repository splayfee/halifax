/**
 * Integration tests: QueryBuilder — all comparison operators and logical connectives
 *
 * Run with: pnpm test:integration
 * Requires DATABASE_URL in .env.test (loaded automatically via dotenv-cli).
 * All tests are skipped when DATABASE_URL is not set.
 *
 * Seed data per test:
 *   Post 1 (Alpha)   — published: true,  content: 'body'
 *   Post 2 (Bravo)   — published: false, content: null
 *   Post 3 (Charlie) — published: true,  content: null
 *
 * The auto-increment IDs are captured after insert so numeric comparisons
 * remain stable regardless of the current sequence value.
 */

import { connectIntegrationDb } from '../helpers/integrationDb.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaAdapter, SqlComparison, type IQueryOptions } from '@/index.js'

const hasDb = !!process.env.DATABASE_URL

type Post = {
  id: number | string
  title: string
  content?: string | null
  published?: boolean
}

/** Typed view of the Prisma client returned by `connectIntegrationDb()`. */
type PrismaClient = Awaited<ReturnType<typeof connectIntegrationDb>> & {
  post: {
    deleteMany(args?: unknown): Promise<{ count: number }>
    create(args: { data: unknown }): Promise<Post>
    findMany(args?: unknown): Promise<Post[]>
    count(args?: unknown): Promise<number>
    update(args: unknown): Promise<Post>
    delete(args: unknown): Promise<unknown>
  }
  author: {
    deleteMany(args?: unknown): Promise<{ count: number }>
  }
}

const FIELDS = ['id', 'title', 'published', 'content']

describe.skipIf(!hasDb)('QueryBuilder integration — comparison operators', () => {
  let prisma: PrismaClient
  let repo: PrismaAdapter
  // Integer keys on SQL engines, 24-char ObjectId strings on MongoDB — captured after insert.
  let id1: string | number
  let id2: string | number
  let id3: string | number

  beforeAll(async () => {
    prisma = (await connectIntegrationDb()) as PrismaClient
    await prisma.$connect()
    repo = new PrismaAdapter({ delegate: prisma.post })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.post.deleteMany()
    await prisma.author.deleteMany()
    const p1 = await prisma.post.create({
      data: { title: 'Alpha', published: true, content: 'body' }
    })
    const p2 = await prisma.post.create({ data: { title: 'Bravo', published: false } })
    const p3 = await prisma.post.create({ data: { title: 'Charlie', published: true } })
    id1 = p1.id
    id2 = p2.id
    id3 = p3.id
  })

  // ---------------------------------------------------------------------------
  // Equality
  // ---------------------------------------------------------------------------

  it('Equal (=): returns rows matching boolean value', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'published', comparison: SqlComparison.Equal, value1: true }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2)
    const titles = results.map((r) => (r as Post).title)
    expect(titles).toContain('Alpha')
    expect(titles).toContain('Charlie')
  })

  it('Not Equal (<>): excludes rows matching the value', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'published', comparison: SqlComparison.NotEqual, value1: true }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(1)
    expect((results[0] as Post).title).toBe('Bravo')
  })

  // ---------------------------------------------------------------------------
  // Numeric comparisons
  // ---------------------------------------------------------------------------

  it('Greater Than (>): returns rows with id above threshold', async () => {
    const { count } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'id', comparison: SqlComparison.GreaterThan, value1: id1 }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2) // id2 and id3
  })

  it('Less Than (<): returns rows with id below threshold', async () => {
    const { count } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'id', comparison: SqlComparison.LessThan, value1: id3 }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2) // id1 and id2
  })

  it('Greater Than or Equal (>=): includes the boundary value', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'id', comparison: SqlComparison.GreaterThanOrEqual, value1: id2 }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2) // id2 and id3
    const ids = results.map((r) => (r as Post).id)
    expect(ids).toContain(id2)
    expect(ids).toContain(id3)
  })

  it('Less Than or Equal (<=): includes the boundary value', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'id', comparison: SqlComparison.LessThanOrEqual, value1: id2 }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2) // id1 and id2
    const ids = results.map((r) => (r as Post).id)
    expect(ids).toContain(id1)
    expect(ids).toContain(id2)
  })

  // ---------------------------------------------------------------------------
  // Range
  // ---------------------------------------------------------------------------

  it('BETWEEN: returns all rows within the inclusive range', async () => {
    const { count } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'id', comparison: SqlComparison.Between, value1: id1, value2: id3 }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(3)
  })

  it('NOT BETWEEN: returns only rows outside the range', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'id', comparison: SqlComparison.NotBetween, value1: id1, value2: id2 }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(1)
    expect((results[0] as Post).id).toBe(id3)
  })

  // ---------------------------------------------------------------------------
  // Set membership
  // ---------------------------------------------------------------------------

  it('IN: returns rows whose column value is in the list', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'title', comparison: SqlComparison.In, value1: ['Alpha', 'Charlie'] }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2)
    const titles = results.map((r) => (r as Post).title)
    expect(titles).toContain('Alpha')
    expect(titles).toContain('Charlie')
  })

  it('NOT IN: excludes rows whose column value is in the list', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'title', comparison: SqlComparison.NotIn, value1: ['Alpha', 'Charlie'] }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(1)
    expect((results[0] as Post).title).toBe('Bravo')
  })

  // ---------------------------------------------------------------------------
  // Pattern matching
  // ---------------------------------------------------------------------------

  it('LIKE: returns rows matching the SQL pattern', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'title', comparison: SqlComparison.Like, value1: 'Alpha%' }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(1)
    expect((results[0] as Post).title).toBe('Alpha')
  })

  it('NOT LIKE: excludes rows matching the SQL pattern', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'title', comparison: SqlComparison.NotLike, value1: 'Alpha%' }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2)
    const titles = results.map((r) => (r as Post).title)
    expect(titles).not.toContain('Alpha')
  })

  // ---------------------------------------------------------------------------
  // Null checks
  // ---------------------------------------------------------------------------

  it('IS NULL: returns rows where the nullable column is null', async () => {
    // Bravo and Charlie have null content; Alpha has 'body'
    const { count } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'content', comparison: SqlComparison.IsNull }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2)
  })

  it('IS NOT NULL: returns rows where the nullable column has a value', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [{ field: 'content', comparison: SqlComparison.IsNotNull }],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(1)
    expect((results[0] as Post).title).toBe('Alpha')
  })
})

describe.skipIf(!hasDb)('QueryBuilder integration — logical connectives and nesting', () => {
  let prisma: PrismaClient
  let repo: PrismaAdapter
  let id1: string | number
  let id3: string | number

  beforeAll(async () => {
    prisma = (await connectIntegrationDb()) as PrismaClient
    await prisma.$connect()
    repo = new PrismaAdapter({ delegate: prisma.post })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.post.deleteMany()
    await prisma.author.deleteMany()
    const p1 = await prisma.post.create({
      data: { title: 'Alpha', published: true, content: 'body' }
    })
    await prisma.post.create({ data: { title: 'Bravo', published: false } })
    const p3 = await prisma.post.create({ data: { title: 'Charlie', published: true } })
    id1 = p1.id
    id3 = p3.id
  })

  // ---------------------------------------------------------------------------
  // Logical AND
  // ---------------------------------------------------------------------------

  it('AND: narrows to only rows satisfying both conditions', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [
        { field: 'published', comparison: SqlComparison.Equal, value1: true, operator: 'AND' },
        { field: 'title', comparison: SqlComparison.Equal, value1: 'Alpha' }
      ],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(1)
    expect((results[0] as Post).title).toBe('Alpha')
  })

  it('AND chain (three conditions): returns intersection of all', async () => {
    const { count } = await repo.executeQuery!({
      fields: FIELDS,
      where: [
        { field: 'id', comparison: SqlComparison.GreaterThanOrEqual, value1: id1, operator: 'AND' },
        { field: 'id', comparison: SqlComparison.LessThanOrEqual, value1: id3, operator: 'AND' },
        { field: 'published', comparison: SqlComparison.Equal, value1: true }
      ],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2) // Alpha and Charlie
  })

  // ---------------------------------------------------------------------------
  // Logical OR
  // ---------------------------------------------------------------------------

  it('OR: returns all rows satisfying either condition', async () => {
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [
        { field: 'title', comparison: SqlComparison.Equal, value1: 'Alpha', operator: 'OR' },
        { field: 'title', comparison: SqlComparison.Equal, value1: 'Bravo' }
      ],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2)
    const titles = results.map((r) => (r as Post).title)
    expect(titles).toContain('Alpha')
    expect(titles).toContain('Bravo')
  })

  it('OR: with disjoint conditions returns the union', async () => {
    // content IS NOT NULL (Alpha) OR published = false (Bravo) → 2 rows
    const { count } = await repo.executeQuery!({
      fields: FIELDS,
      where: [
        { field: 'content', comparison: SqlComparison.IsNotNull, operator: 'OR' },
        { field: 'published', comparison: SqlComparison.Equal, value1: false }
      ],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2)
  })

  // ---------------------------------------------------------------------------
  // Nested children (parenthesised sub-groups)
  //
  // Each IQueryFilter can carry a `children` array that is rendered as a
  // parenthesised group in the SQL:
  //   { field, comparison, value1, operator, children: [...] }
  //   → "<field> <op> $n  <operator>  (<children SQL>)"
  // ---------------------------------------------------------------------------

  it('AND with nested children: sub-group is wrapped in parentheses', async () => {
    // WHERE published = true AND (title = 'Alpha')
    // → only Alpha
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [
        {
          field: 'published',
          comparison: SqlComparison.Equal,
          value1: true,
          operator: 'AND',
          children: [{ field: 'title', comparison: SqlComparison.Equal, value1: 'Alpha' }]
        }
      ],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(1)
    expect((results[0] as Post).title).toBe('Alpha')
  })

  it('OR with nested children: rows satisfying either branch are returned', async () => {
    // WHERE published = false OR (title LIKE 'Alpha%')
    // → Bravo (published=false) + Alpha (title like 'Alpha%') = 2 rows
    const { count, results } = await repo.executeQuery!({
      fields: FIELDS,
      where: [
        {
          field: 'published',
          comparison: SqlComparison.Equal,
          value1: false,
          operator: 'OR',
          children: [{ field: 'title', comparison: SqlComparison.Like, value1: 'Alpha%' }]
        }
      ],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2)
    const titles = results.map((r) => (r as Post).title)
    expect(titles).toContain('Bravo')
    expect(titles).toContain('Alpha')
  })

  it('nested IN inside an AND group: correct rows returned', async () => {
    // WHERE published = true AND (title IN ('Alpha', 'Charlie'))
    // → both Alpha and Charlie (published + in-list)
    const { count } = await repo.executeQuery!({
      fields: FIELDS,
      where: [
        {
          field: 'published',
          comparison: SqlComparison.Equal,
          value1: true,
          operator: 'AND',
          children: [{ field: 'title', comparison: SqlComparison.In, value1: ['Alpha', 'Charlie'] }]
        }
      ],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2)
  })

  it('nested BETWEEN inside an OR group: correct rows returned', async () => {
    // WHERE title = 'Bravo' OR (id BETWEEN id1 AND id1)
    // → Bravo + Alpha = 2 rows
    const { count } = await repo.executeQuery!({
      fields: FIELDS,
      where: [
        {
          field: 'title',
          comparison: SqlComparison.Equal,
          value1: 'Bravo',
          operator: 'OR',
          children: [{ field: 'id', comparison: SqlComparison.Between, value1: id1, value2: id1 }]
        }
      ],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2)
  })

  it('multi-level nesting: children with their own children', async () => {
    // WHERE id = id1 OR (published = true AND (title = 'Charlie'))
    // → Alpha (id=id1) OR (published=true AND title='Charlie') → Alpha + Charlie = 2
    const { count } = await repo.executeQuery!({
      fields: FIELDS,
      where: [
        {
          field: 'id',
          comparison: SqlComparison.Equal,
          value1: id1,
          operator: 'OR',
          children: [
            {
              field: 'published',
              comparison: SqlComparison.Equal,
              value1: true,
              operator: 'AND',
              children: [{ field: 'title', comparison: SqlComparison.Equal, value1: 'Charlie' }]
            }
          ]
        }
      ],
      limit: 10,
      offset: 0
    } satisfies IQueryOptions)
    expect(count).toBe(2)
  })
})
