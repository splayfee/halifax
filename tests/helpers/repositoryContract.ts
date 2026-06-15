/**
 * Adapter-agnostic integration contract for any Halifax `Repository` implementation.
 *
 * Call `runRepositoryContract(name, createSetup)` once per adapter. The suite drives the
 * repository through the same scenarios that Prisma's bespoke integration tests cover, so
 * every new adapter gets identical coverage without duplicating test logic.
 *
 * Required schema (any backing DB):
 *   id        — integer PK (autoincrement / serial)
 *   title     — string, NOT NULL, default ''
 *   content   — string | null
 *   published — boolean, NOT NULL, default false
 *   tenantId  — string | null  (used by the tenant-isolation suite)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SqlComparison, SqlOperator, SqlOrder } from '@edium/halifax-types'
import type { Repository } from '@/core/types.js'

// Post shape shared by all test suites in this file.
type Post = {
  id: number | string
  title: string
  content: string | null
  published: boolean
  tenantId?: string | null
}
type AnyPost = Post

export interface RepoContractSetup {
  /** The repository under test (unscoped). */
  repo: Repository<Post>
  /**
   * Delete **all** records from the backing store.
   * Called both as the outer `beforeEach` seed-reset and within the tenant suite
   * to override the outer seed with tenant-specific data.
   */
  cleanup: () => Promise<void>
  /** Close DB connections, release resources — called once after the whole suite. */
  teardown?: () => Promise<void>
}

const FIELDS = ['id', 'title', 'published', 'content']

/**
 * Runs the full repository contract against any adapter.
 *
 * @param name          - Display name used as the outer `describe` label.
 * @param createSetup   - Factory called once in `beforeAll`; returns the repo, cleanup,
 *                        and optional teardown. May be async.
 */
export function runRepositoryContract(
  name: string,
  createSetup: () => Promise<RepoContractSetup> | RepoContractSetup
): void {
  describe(`${name} — repository contract`, () => {
    let repo: Repository<Post>
    let cleanup: () => Promise<void>
    let teardown: (() => Promise<void>) | undefined

    // Ids captured after seeding — used in numeric / range comparison tests.
    let id1: number | string
    let id2: number | string
    let id3: number | string

    beforeAll(async () => {
      const setup = await createSetup()
      repo = setup.repo
      cleanup = setup.cleanup
      teardown = setup.teardown
    })

    afterAll(async () => {
      await teardown?.()
    })

    /**
     * Standard three-row seed:
     *   Alpha   (published: true,  content: 'body')
     *   Bravo   (published: false, content: null)
     *   Charlie (published: true,  content: null)
     */
    beforeEach(async () => {
      await cleanup()
      const p1 = await repo.createOne({
        title: 'Alpha',
        published: true,
        content: 'body',
        tenantId: null
      })
      const p2 = await repo.createOne({
        title: 'Bravo',
        published: false,
        content: null,
        tenantId: null
      })
      const p3 = await repo.createOne({
        title: 'Charlie',
        published: true,
        content: null,
        tenantId: null
      })
      id1 = (p1 as AnyPost).id
      id2 = (p2 as AnyPost).id
      id3 = (p3 as AnyPost).id
    })

    // ─── CRUD ─────────────────────────────────────────────────────────────────

    describe('CRUD', () => {
      it('createOne returns the created record with a generated id', async () => {
        const post = (await repo.createOne({
          title: 'New',
          published: false,
          content: null,
          tenantId: null
        })) as AnyPost
        expect(post.id).toBeTruthy()
        expect(post.title).toBe('New')
      })

      it('createMany inserts all records', async () => {
        await cleanup()
        await repo.createMany([
          { title: 'A', published: true, content: null, tenantId: null },
          { title: 'B', published: false, content: null, tenantId: null }
        ])
        const { count } = await repo.getMany()
        expect(count).toBe(2)
      })

      it('createMany returns an empty array for empty input', async () => {
        const result = await repo.createMany([])
        expect(result).toEqual([])
      })

      it('getOne returns the record by id', async () => {
        const found = (await repo.getOne(id1)) as AnyPost
        expect(found?.title).toBe('Alpha')
      })

      it('getOne returns null for a missing id', async () => {
        expect(await repo.getOne(999_999)).toBeNull()
      })

      it('getOne with fields returns only requested columns', async () => {
        const found = (await repo.getOne(id1, { fields: ['id', 'title'] })) as AnyPost
        expect(found?.id).toBeDefined()
        expect(found?.title).toBeDefined()
        // 'content' was not requested — driver-dependent whether it's absent or undefined
        expect(found?.content ?? undefined).toBeUndefined()
      })

      it('getMany returns count and results', async () => {
        const { count, results } = await repo.getMany()
        expect(count).toBe(3)
        expect(results).toHaveLength(3)
      })

      it('getMany returns { count: 0, results: [] } when empty', async () => {
        await cleanup()
        const { count, results } = await repo.getMany()
        expect(count).toBe(0)
        expect(results).toHaveLength(0)
      })

      it('getMany respects limit and offset — page size and total count stay consistent', async () => {
        for (let i = 4; i <= 6; i++) {
          await repo.createOne({
            title: `Post ${i}`,
            published: true,
            content: null,
            tenantId: null
          })
        }
        const page = await repo.getMany({ limit: 2, offset: 2 })
        expect(page.results).toHaveLength(2)
        expect(page.count).toBe(6)
      })

      it('getMany filters with a simple equality where clause', async () => {
        const { count } = await repo.getMany({ where: { published: false } })
        expect(count).toBe(1)
      })

      it('getMany sorts ascending', async () => {
        const { results } = await repo.getMany({ orderBy: [{ field: 'title', direction: 'asc' }] })
        expect((results[0] as AnyPost).title).toBe('Alpha')
        expect((results[2] as AnyPost).title).toBe('Charlie')
      })

      it('getMany sorts descending', async () => {
        const { results } = await repo.getMany({ orderBy: [{ field: 'title', direction: 'desc' }] })
        expect((results[0] as AnyPost).title).toBe('Charlie')
      })

      it('updateOne returns the updated record', async () => {
        const updated = (await repo.updateOne(id1, {
          title: 'Updated'
        } as Partial<Post>)) as AnyPost
        expect(updated?.title).toBe('Updated')
      })

      it('updateOne returns null for a missing id', async () => {
        expect(await repo.updateOne(999_999, { title: 'Ghost' } as Partial<Post>)).toBeNull()
      })

      it('upsertOne creates a record when the id is absent', async () => {
        const result = (await repo.upsertOne!(999_998, {
          title: 'Upserted',
          published: false,
          content: null,
          tenantId: null
        } as Post)) as AnyPost
        expect(result.title).toBe('Upserted')
      })

      it('upsertOne updates an existing record', async () => {
        const result = (await repo.upsertOne!(id1, {
          title: 'Via upsert',
          published: false,
          content: null,
          tenantId: null
        } as Post)) as AnyPost
        expect(result.title).toBe('Via upsert')
      })

      it('deleteOne removes the record and returns true', async () => {
        expect(await repo.deleteOne(id1)).toBe(true)
        expect(await repo.getOne(id1)).toBeNull()
      })

      it('deleteOne returns false for a missing id', async () => {
        expect(await repo.deleteOne(999_999)).toBe(false)
      })

      it('updateMany updates matching records and returns their ids', async () => {
        const result = await repo.updateMany!(
          { where: [{ field: 'published', comparison: SqlComparison.Equal, value1: false }] },
          { published: true } as Partial<Post>
        )
        expect(result.updated).toHaveLength(1)
        const { count } = await repo.getMany({ where: { published: false } })
        expect(count).toBe(0)
      })

      it('deleteMany removes matching records and returns their ids', async () => {
        const result = await repo.deleteMany!({
          where: [{ field: 'published', comparison: SqlComparison.Equal, value1: false }]
        })
        expect(result.deleted).toHaveLength(1)
        const { count } = await repo.getMany()
        expect(count).toBe(2)
      })
    })

    // ─── executeQuery — comparison operators ──────────────────────────────────

    describe('executeQuery — comparison operators', () => {
      it('Equal (=): matches boolean value', async () => {
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'published', comparison: SqlComparison.Equal, value1: true }]
        })
        expect(count).toBe(2)
      })

      it('NotEqual (<>): excludes the matching value', async () => {
        const { count, results } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'published', comparison: SqlComparison.NotEqual, value1: true }]
        })
        expect(count).toBe(1)
        expect((results[0] as AnyPost).title).toBe('Bravo')
      })

      it('GreaterThan (>): returns rows above the threshold', async () => {
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'id', comparison: SqlComparison.GreaterThan, value1: id1 }]
        })
        expect(count).toBe(2)
      })

      it('LessThan (<): returns rows below the threshold', async () => {
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'id', comparison: SqlComparison.LessThan, value1: id3 }]
        })
        expect(count).toBe(2)
      })

      it('GreaterThanOrEqual (>=): includes the boundary', async () => {
        const { count, results } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'id', comparison: SqlComparison.GreaterThanOrEqual, value1: id2 }]
        })
        expect(count).toBe(2)
        const ids = results.map((r: AnyPost) => r.id)
        expect(ids).toContain(id2)
        expect(ids).toContain(id3)
      })

      it('LessThanOrEqual (<=): includes the boundary', async () => {
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'id', comparison: SqlComparison.LessThanOrEqual, value1: id2 }]
        })
        expect(count).toBe(2)
      })

      it('Between: inclusive range returns all rows within', async () => {
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'id', comparison: SqlComparison.Between, value1: id1, value2: id3 }]
        })
        expect(count).toBe(3)
      })

      it('NotBetween: rows outside the range', async () => {
        const { count, results } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'id', comparison: SqlComparison.NotBetween, value1: id1, value2: id2 }]
        })
        expect(count).toBe(1)
        expect((results[0] as AnyPost).id).toBe(id3)
      })

      it('In: returns rows whose value is in the list', async () => {
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'title', comparison: SqlComparison.In, value1: ['Alpha', 'Charlie'] }]
        })
        expect(count).toBe(2)
      })

      it('NotIn: excludes rows whose value is in the list', async () => {
        const { count, results } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'title', comparison: SqlComparison.NotIn, value1: ['Alpha', 'Charlie'] }]
        })
        expect(count).toBe(1)
        expect((results[0] as AnyPost).title).toBe('Bravo')
      })

      it('Like: matches a SQL LIKE pattern', async () => {
        const { count, results } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'title', comparison: SqlComparison.Like, value1: 'Alpha%' }]
        })
        expect(count).toBe(1)
        expect((results[0] as AnyPost).title).toBe('Alpha')
      })

      it('NotLike: excludes rows matching the pattern', async () => {
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'title', comparison: SqlComparison.NotLike, value1: 'Alpha%' }]
        })
        expect(count).toBe(2)
      })

      it('Contains: substring match (LIKE %value%)', async () => {
        const { count, results } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'title', comparison: SqlComparison.Contains, value1: 'harl' }]
        })
        expect(count).toBe(1)
        expect((results[0] as AnyPost).title).toBe('Charlie')
      })

      it('StartsWith: prefix match', async () => {
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'title', comparison: SqlComparison.StartsWith, value1: 'Br' }]
        })
        expect(count).toBe(1)
      })

      it('EndsWith: suffix match', async () => {
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'title', comparison: SqlComparison.EndsWith, value1: 'lie' }]
        })
        expect(count).toBe(1)
      })

      it('IsNull: returns rows where the nullable column is null', async () => {
        // Bravo and Charlie have null content
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'content', comparison: SqlComparison.IsNull }]
        })
        expect(count).toBe(2)
      })

      it('IsNotNull: returns rows where the column has a value', async () => {
        const { count, results } = await repo.executeQuery!({
          fields: FIELDS,
          where: [{ field: 'content', comparison: SqlComparison.IsNotNull }]
        })
        expect(count).toBe(1)
        expect((results[0] as AnyPost).title).toBe('Alpha')
      })

      it('no where clause returns all records', async () => {
        const { count } = await repo.executeQuery!({ fields: FIELDS })
        expect(count).toBe(3)
      })

      it('applies limit and offset with correct total count', async () => {
        const { count, results } = await repo.executeQuery!({ fields: FIELDS, limit: 2, offset: 0 })
        expect(count).toBe(3)
        expect(results).toHaveLength(2)
      })

      it('applies orderBy ascending', async () => {
        const { results } = await repo.executeQuery!({
          fields: FIELDS,
          orderBy: [{ field: 'title', order: SqlOrder.ASC }]
        })
        expect((results[0] as AnyPost).title).toBe('Alpha')
        expect((results[2] as AnyPost).title).toBe('Charlie')
      })

      it('applies orderBy descending', async () => {
        const { results } = await repo.executeQuery!({
          fields: FIELDS,
          orderBy: [{ field: 'title', order: SqlOrder.DESC }]
        })
        expect((results[0] as AnyPost).title).toBe('Charlie')
      })
    })

    // ─── executeQuery — logical connectives ───────────────────────────────────

    describe('executeQuery — logical connectives and nesting', () => {
      it('AND: intersection of both conditions', async () => {
        const { count, results } = await repo.executeQuery!({
          fields: FIELDS,
          where: [
            {
              field: 'published',
              comparison: SqlComparison.Equal,
              value1: true,
              operator: SqlOperator.And
            },
            { field: 'title', comparison: SqlComparison.Equal, value1: 'Alpha' }
          ]
        })
        expect(count).toBe(1)
        expect((results[0] as AnyPost).title).toBe('Alpha')
      })

      it('AND chain (three conditions): returns intersection of all', async () => {
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [
            {
              field: 'id',
              comparison: SqlComparison.GreaterThanOrEqual,
              value1: id1,
              operator: SqlOperator.And
            },
            {
              field: 'id',
              comparison: SqlComparison.LessThanOrEqual,
              value1: id3,
              operator: SqlOperator.And
            },
            { field: 'published', comparison: SqlComparison.Equal, value1: true }
          ]
        })
        expect(count).toBe(2) // Alpha and Charlie
      })

      it('OR: union of both conditions', async () => {
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [
            {
              field: 'title',
              comparison: SqlComparison.Equal,
              value1: 'Alpha',
              operator: SqlOperator.Or
            },
            { field: 'title', comparison: SqlComparison.Equal, value1: 'Bravo' }
          ]
        })
        expect(count).toBe(2)
      })

      it('OR: disjoint conditions return the union', async () => {
        // content IS NOT NULL (Alpha) OR published = false (Bravo) → 2 rows
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [
            { field: 'content', comparison: SqlComparison.IsNotNull, operator: SqlOperator.Or },
            { field: 'published', comparison: SqlComparison.Equal, value1: false }
          ]
        })
        expect(count).toBe(2)
      })

      it('AND with nested children: sub-group is parenthesised', async () => {
        // WHERE published = true AND (title = 'Alpha') → only Alpha
        const { count, results } = await repo.executeQuery!({
          fields: FIELDS,
          where: [
            {
              field: 'published',
              comparison: SqlComparison.Equal,
              value1: true,
              operator: SqlOperator.And,
              children: [{ field: 'title', comparison: SqlComparison.Equal, value1: 'Alpha' }]
            }
          ]
        })
        expect(count).toBe(1)
        expect((results[0] as AnyPost).title).toBe('Alpha')
      })

      it('OR with nested children: rows satisfying either branch', async () => {
        // WHERE published = false OR (title LIKE 'Alpha%') → Bravo + Alpha = 2
        const { count, results } = await repo.executeQuery!({
          fields: FIELDS,
          where: [
            {
              field: 'published',
              comparison: SqlComparison.Equal,
              value1: false,
              operator: SqlOperator.Or,
              children: [{ field: 'title', comparison: SqlComparison.Like, value1: 'Alpha%' }]
            }
          ]
        })
        expect(count).toBe(2)
        const titles = results.map((r: AnyPost) => r.title)
        expect(titles).toContain('Bravo')
        expect(titles).toContain('Alpha')
      })

      it('nested IN inside an AND group', async () => {
        // WHERE published = true AND (title IN ('Alpha', 'Charlie'))
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [
            {
              field: 'published',
              comparison: SqlComparison.Equal,
              value1: true,
              operator: SqlOperator.And,
              children: [
                { field: 'title', comparison: SqlComparison.In, value1: ['Alpha', 'Charlie'] }
              ]
            }
          ]
        })
        expect(count).toBe(2)
      })

      it('nested BETWEEN inside an OR group', async () => {
        // WHERE title = 'Bravo' OR (id BETWEEN id1 AND id1) → Bravo + Alpha = 2
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [
            {
              field: 'title',
              comparison: SqlComparison.Equal,
              value1: 'Bravo',
              operator: SqlOperator.Or,
              children: [
                { field: 'id', comparison: SqlComparison.Between, value1: id1, value2: id1 }
              ]
            }
          ]
        })
        expect(count).toBe(2)
      })

      it('multi-level nesting: children with their own children', async () => {
        // WHERE id = id1 OR (published = true AND (title = 'Charlie')) → Alpha + Charlie = 2
        const { count } = await repo.executeQuery!({
          fields: FIELDS,
          where: [
            {
              field: 'id',
              comparison: SqlComparison.Equal,
              value1: id1,
              operator: SqlOperator.Or,
              children: [
                {
                  field: 'published',
                  comparison: SqlComparison.Equal,
                  value1: true,
                  operator: SqlOperator.And,
                  children: [{ field: 'title', comparison: SqlComparison.Equal, value1: 'Charlie' }]
                }
              ]
            }
          ]
        })
        expect(count).toBe(2)
      })
    })

    // ─── withScope — tenant isolation ─────────────────────────────────────────

    describe('withScope — tenant isolation', () => {
      // Re-seed with tenant-specific data, overriding the outer beforeEach.
      beforeEach(async () => {
        await cleanup()
        await repo.createOne({ title: 'A1', published: true, content: null, tenantId: 'tenant-a' })
        await repo.createOne({ title: 'A2', published: false, content: null, tenantId: 'tenant-a' })
        await repo.createOne({ title: 'B1', published: true, content: null, tenantId: 'tenant-b' })
      })

      it('getMany returns only rows for the scoped tenant', async () => {
        const repoA = repo.withScope!({ field: 'tenantId', value: 'tenant-a' })
        const result = await repoA.getMany()
        expect(result.count).toBe(2)
        expect((result.results as AnyPost[]).every((r) => r.tenantId === 'tenant-a')).toBe(true)
      })

      it('getOne returns null for a record owned by another tenant', async () => {
        const allB = await repo.withScope!({ field: 'tenantId', value: 'tenant-b' }).getMany()
        const bRow = allB.results[0] as AnyPost
        const repoA = repo.withScope!({ field: 'tenantId', value: 'tenant-a' })
        expect(await repoA.getOne(bRow.id)).toBeNull()
      })

      it('createOne stamps the tenant field automatically', async () => {
        const repoA = repo.withScope!({ field: 'tenantId', value: 'tenant-a' })
        const created = (await repoA.createOne({
          title: 'New',
          published: false,
          content: null
        } as Post)) as AnyPost
        expect(created.tenantId).toBe('tenant-a')
      })

      it('updateOne cannot modify a row owned by another tenant', async () => {
        const allB = await repo.withScope!({ field: 'tenantId', value: 'tenant-b' }).getMany()
        const bRow = allB.results[0] as AnyPost
        const repoA = repo.withScope!({ field: 'tenantId', value: 'tenant-a' })
        expect(await repoA.updateOne(bRow.id, { title: 'hacked' } as Partial<Post>)).toBeNull()
        // Confirm the original is untouched
        const repoB = repo.withScope!({ field: 'tenantId', value: 'tenant-b' })
        const stillB = (await repoB.getOne(bRow.id)) as AnyPost
        expect(stillB?.title).toBe('B1')
      })

      it('deleteMany only deletes within the tenant scope', async () => {
        const repoA = repo.withScope!({ field: 'tenantId', value: 'tenant-a' })
        await repoA.deleteMany!({
          where: [{ field: 'published', comparison: SqlComparison.Equal, value1: false }]
        })
        const remaining = await repo.getMany()
        expect(remaining.count).toBe(2) // A1 + B1 still exist
        const titles = (remaining.results as AnyPost[]).map((r) => r.title)
        expect(titles).not.toContain('A2')
        expect(titles).toContain('B1')
      })

      it('executeQuery is confined to the caller tenant', async () => {
        const repoA = repo.withScope!({ field: 'tenantId', value: 'tenant-a' })
        const result = await repoA.executeQuery!({
          where: [{ field: 'published', comparison: SqlComparison.Equal, value1: true }]
        })
        expect(result.count).toBe(1)
        expect((result.results[0] as AnyPost).tenantId).toBe('tenant-a')
      })

      it('a caller OR cannot escape the tenant boundary', async () => {
        // Scoped to A: title='A1' OR tenantId='tenant-b' — the OR is pinned under the
        // tenant predicate, so tenant-b rows are never reachable.
        const repoA = repo.withScope!({ field: 'tenantId', value: 'tenant-a' })
        const result = await repoA.executeQuery!({
          where: [
            {
              field: 'title',
              comparison: SqlComparison.Equal,
              value1: 'A1',
              operator: SqlOperator.Or
            },
            { field: 'tenantId', comparison: SqlComparison.Equal, value1: 'tenant-b' }
          ]
        })
        expect(result.count).toBe(1)
        expect((result.results[0] as AnyPost).tenantId).toBe('tenant-a')
      })
    })
  })
}
