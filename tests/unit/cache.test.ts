import { describe, it, expect, vi } from 'vitest'
import { InMemoryCacheStore, createCachingRepository } from '@/core/cache/index.js'
import type { ListResult, Repository } from '@/core/types.js'

type Row = { id: number; name: string }

describe('InMemoryCacheStore', () => {
  it('stores and retrieves a value', () => {
    const store = new InMemoryCacheStore()
    store.set('k', { a: 1 })
    expect(store.get('k')).toEqual({ a: 1 })
  })

  it('expires entries after their TTL', () => {
    let now = 1000
    const store = new InMemoryCacheStore(() => now)
    store.set('k', 'v', 5) // 5 seconds
    expect(store.get('k')).toBe('v')
    now += 5001
    expect(store.get('k')).toBeUndefined()
  })

  it('never expires when no TTL is given', () => {
    let now = 0
    const store = new InMemoryCacheStore(() => now)
    store.set('k', 'v')
    now += 10_000_000
    expect(store.get('k')).toBe('v')
  })

  it('deletes a key', () => {
    const store = new InMemoryCacheStore()
    store.set('k', 'v')
    store.delete('k')
    expect(store.get('k')).toBeUndefined()
  })
})

/** Builds a repository whose reads are counted, so we can prove cache hits/misses. */
function makeCountingRepo() {
  const calls = { getMany: 0, getOne: 0, queryBuilder: 0 }
  const repo: Repository<Row> = {
    async getMany(): Promise<ListResult<Row>> {
      calls.getMany++
      return { count: 1, results: [{ id: 1, name: 'a' }] }
    },
    async getOne(id) {
      calls.getOne++
      return { id: Number(id), name: 'a' }
    },
    async createOne(data) {
      return { id: 2, name: '', ...data } as Row
    },
    async createMany(data) {
      return data.map((d) => ({ id: 2, name: '', ...d }) as Row)
    },
    async updateOne(id, data) {
      return { id: Number(id), name: '', ...data } as Row
    },
    async deleteOne() {
      return true
    },
    async executeQuery() {
      calls.queryBuilder++
      return { count: 1, results: [{ id: 1, name: 'a' }] }
    }
  }
  return { repo, calls }
}

describe('createCachingRepository', () => {
  it('serves repeated reads from cache (one underlying call)', async () => {
    const { repo, calls } = makeCountingRepo()
    const cached = createCachingRepository(repo, {
      store: new InMemoryCacheStore(),
      ttlSeconds: 60,
      namespace: 'Row:global'
    })
    await cached.getMany({ limit: 10 })
    await cached.getMany({ limit: 10 })
    expect(calls.getMany).toBe(1)
  })

  it('keys by query args (different queries miss separately)', async () => {
    const { repo, calls } = makeCountingRepo()
    const cached = createCachingRepository(repo, {
      store: new InMemoryCacheStore(),
      ttlSeconds: 60,
      namespace: 'Row:global'
    })
    await cached.getMany({ limit: 10 })
    await cached.getMany({ limit: 20 })
    expect(calls.getMany).toBe(2)
  })

  it('invalidates cached reads after a write (version bump)', async () => {
    const { repo, calls } = makeCountingRepo()
    const cached = createCachingRepository(repo, {
      store: new InMemoryCacheStore(),
      ttlSeconds: 60,
      namespace: 'Row:global'
    })
    await cached.getMany({ limit: 10 })
    await cached.createOne({ name: 'b' })
    await cached.getMany({ limit: 10 })
    expect(calls.getMany).toBe(2)
  })

  it('never expires when ttlSeconds is 0 (cache forever)', async () => {
    let now = 0
    const { repo, calls } = makeCountingRepo()
    const cached = createCachingRepository(repo, {
      store: new InMemoryCacheStore(() => now),
      ttlSeconds: 0,
      namespace: 'Row:global'
    })
    await cached.getMany()
    now += 10_000_000
    await cached.getMany()
    expect(calls.getMany).toBe(1)
  })

  it('bust:true bypasses the cache and force-refreshes', async () => {
    const store = new InMemoryCacheStore()
    const { repo, calls } = makeCountingRepo()
    await createCachingRepository(repo, {
      store,
      ttlSeconds: 60,
      namespace: 'Row:global'
    }).getMany()
    expect(calls.getMany).toBe(1)
    // A bust-wrapped repo skips the lookup and refreshes...
    await createCachingRepository(repo, {
      store,
      ttlSeconds: 60,
      namespace: 'Row:global',
      bust: true
    }).getMany()
    expect(calls.getMany).toBe(2)
    // ...and the refreshed value is served from cache on the next normal read.
    await createCachingRepository(repo, {
      store,
      ttlSeconds: 60,
      namespace: 'Row:global'
    }).getMany()
    expect(calls.getMany).toBe(2)
  })

  it('re-fetches after the TTL expires', async () => {
    let now = 0
    const { repo, calls } = makeCountingRepo()
    const cached = createCachingRepository(repo, {
      store: new InMemoryCacheStore(() => now),
      ttlSeconds: 30,
      namespace: 'Row:global'
    })
    await cached.getMany()
    now += 31_000
    await cached.getMany()
    expect(calls.getMany).toBe(2)
  })

  it('caches the query-builder path and exposes it only when the source repo does', async () => {
    const { repo, calls } = makeCountingRepo()
    const cached = createCachingRepository(repo, {
      store: new InMemoryCacheStore(),
      ttlSeconds: 60,
      namespace: 'Row:global'
    })
    await cached.executeQuery!({})
    await cached.executeQuery!({})
    expect(calls.queryBuilder).toBe(1)

    const { executeQuery: _omit, ...repoWithoutQb } = repo
    void _omit
    const noQb = createCachingRepository(repoWithoutQb, {
      store: new InMemoryCacheStore(),
      ttlSeconds: 60,
      namespace: 'Row:global'
    })
    expect(noQb.executeQuery).toBeUndefined()
  })

  it('isolates tenants via separate namespaces (no cross-tenant leakage)', async () => {
    const store = new InMemoryCacheStore()
    const getMany = vi
      .fn<() => Promise<ListResult<Row>>>()
      .mockResolvedValueOnce({ count: 1, results: [{ id: 1, name: 'tenant-A' }] })
      .mockResolvedValueOnce({ count: 1, results: [{ id: 9, name: 'tenant-B' }] })
    const base: Repository<Row> = {
      getMany,
      async getOne() {
        return null
      },
      async createOne(d) {
        return d as Row
      },
      async createMany(d) {
        return d as Row[]
      },
      async updateOne() {
        return null
      },
      async deleteOne() {
        return false
      }
    }
    const a = createCachingRepository(base, { store, ttlSeconds: 60, namespace: 'Row:A' })
    const b = createCachingRepository(base, { store, ttlSeconds: 60, namespace: 'Row:B' })
    const resA = await a.getMany()
    const resB = await b.getMany()
    expect(resA.results[0]!.name).toBe('tenant-A')
    expect(resB.results[0]!.name).toBe('tenant-B')
    expect(getMany).toHaveBeenCalledTimes(2)
  })

  it('updateMany bumps the cache version and invalidates reads', async () => {
    const calls = { getMany: 0, updateMany: 0 }
    const repo: Repository<Row> = {
      async getMany() { calls.getMany++; return { count: 1, results: [{ id: 1, name: 'a' }] } },
      async getOne() { return null },
      async createOne(d) { return d as Row },
      async createMany(d) { return d as Row[] },
      async updateOne() { return null },
      async deleteOne() { return false },
      async updateMany() { calls.updateMany++; return { updated: [1] } }
    }
    const cached = createCachingRepository(repo, { store: new InMemoryCacheStore(), ttlSeconds: 60, namespace: 'ns' })
    await cached.getMany()
    await cached.updateMany!({}, { name: 'b' })
    await cached.getMany()
    expect(calls.updateMany).toBe(1)
    expect(calls.getMany).toBe(2) // cache busted by updateMany
  })

  it('upsertOne bumps the cache version and invalidates reads', async () => {
    const calls = { getMany: 0 }
    const repo: Repository<Row> = {
      async getMany() { calls.getMany++; return { count: 1, results: [{ id: 1, name: 'a' }] } },
      async getOne() { return null },
      async createOne(d) { return d as Row },
      async createMany(d) { return d as Row[] },
      async updateOne() { return null },
      async deleteOne() { return false },
      async upsertOne(_id, data) { return data as Row }
    }
    const cached = createCachingRepository(repo, { store: new InMemoryCacheStore(), ttlSeconds: 60, namespace: 'ns' })
    await cached.getMany()
    await cached.upsertOne!(1, { name: 'b' })
    await cached.getMany()
    expect(calls.getMany).toBe(2)
  })

  it('deleteMany bumps the cache version and invalidates reads', async () => {
    const calls = { getMany: 0 }
    const repo: Repository<Row> = {
      async getMany() { calls.getMany++; return { count: 1, results: [{ id: 1, name: 'a' }] } },
      async getOne() { return null },
      async createOne(d) { return d as Row },
      async createMany(d) { return d as Row[] },
      async updateOne() { return null },
      async deleteOne() { return false },
      async deleteMany() { return { deleted: [1] } }
    }
    const cached = createCachingRepository(repo, { store: new InMemoryCacheStore(), ttlSeconds: 60, namespace: 'ns' })
    await cached.getMany()
    await cached.deleteMany!({})
    await cached.getMany()
    expect(calls.getMany).toBe(2)
  })

  it('withScope creates a sub-repo whose reads are isolated from the parent namespace', async () => {
    const store = new InMemoryCacheStore()
    const calls = { getMany: 0 }
    const repo: Repository<Row> = {
      async getMany() { calls.getMany++; return { count: 1, results: [{ id: 1, name: 'a' }] } },
      async getOne() { return null },
      async createOne(d) { return d as Row },
      async createMany(d) { return d as Row[] },
      async updateOne() { return null },
      async deleteOne() { return false },
      withScope(_scope) { return this }
    }
    const cached = createCachingRepository(repo, { store, ttlSeconds: 60, namespace: 'ns' })
    const scoped = cached.withScope!({ field: 'tenantId', value: 'a' })
    // Parent and scoped repo have different namespaces — a read in the parent doesn't warm the scoped cache
    await cached.getMany()
    await scoped.getMany()
    expect(calls.getMany).toBe(2) // both issued separate DB calls
  })

  it('optional methods not exposed when underlying repo lacks them', () => {
    const minimal: Repository<Row> = {
      async getMany() { return { count: 0, results: [] } },
      async getOne() { return null },
      async createOne(d) { return d as Row },
      async createMany() { return [] },
      async updateOne() { return null },
      async deleteOne() { return false }
    }
    const cached = createCachingRepository(minimal, { store: new InMemoryCacheStore(), ttlSeconds: 60, namespace: 'ns' })
    expect(cached.updateMany).toBeUndefined()
    expect(cached.upsertOne).toBeUndefined()
    expect(cached.deleteMany).toBeUndefined()
    expect(cached.withScope).toBeUndefined()
    expect(cached.executeQuery).toBeUndefined()
  })
})
