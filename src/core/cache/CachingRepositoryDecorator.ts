import type {
  ListOptions,
  ListResult,
  QueryResult,
  Repository,
  TenantScope
} from '@/core/types.js'
import type { IQueryOptions } from '@edium/halifax-types'
import type { CacheStore } from './CacheStore.js'

/** Options for {@link createCachingRepository}. */
export interface CachingRepositoryOptions {
  /** Backing cache store. */
  store: CacheStore
  /** Time-to-live for cached reads, in seconds. `0` means **never expire** (cache forever). */
  ttlSeconds: number
  /**
   * Key namespace for this repository — must be unique per (resource, tenant) so one
   * tenant can never read another's cached rows. The router builds this from the resource
   * name and the resolved tenant scope value.
   */
  namespace: string
  /**
   * When `true`, reads bypass the cache lookup, fetch fresh from the underlying repository,
   * and overwrite the cached entry. Set per-request from the cache-bust header so a client
   * can force-refresh on demand. Writes still invalidate as usual.
   */
  bust?: boolean
}

/** Produces a deterministic string for a value so equal queries hash to the same key. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`
}

/**
 * Wraps a {@link Repository} with read-through caching and write invalidation — the GoF
 * **Decorator** pattern: the returned object implements the same `Repository` interface as the
 * one it wraps, transparently adding caching behaviour without the wrapped repository (or its
 * callers) knowing. This factory builds the decorator.
 *
 * - **Reads** (`getOne`, `getMany`, `executeQuery`) are cached under a versioned key.
 * - **Writes** (`createOne/Many`, `updateOne/Many`, `upsertOne`, `deleteOne/Many`) bump the
 *   namespace version, so every previously-cached read for this resource/tenant is instantly
 *   stale (old keys simply fall out by TTL — no scan needed, which keeps Redis cheap).
 *
 * Caching sits at the repository layer, *below* the router's auth checks, so every request
 * is still authenticated and authorized — only the database round-trip is skipped. Optional
 * methods are only exposed when the wrapped repository implements them, so the router's
 * capability probing (`if (!repo.executeQuery) …`) keeps working.
 *
 * @param repo - The repository to wrap (already tenant-scoped by the caller, if applicable).
 * @param options - Cache store, TTL, namespace, and optional bust flag.
 * @returns A repository with the same surface as `repo`, plus caching.
 */
export function createCachingRepository<TRecord, TCreate, TUpdate>(
  repo: Repository<TRecord, TCreate, TUpdate>,
  options: CachingRepositoryOptions
): Repository<TRecord, TCreate, TUpdate> {
  const { store, ttlSeconds, namespace, bust = false } = options
  const versionKey = `${namespace}:__ver`

  const readVersion = async (): Promise<number> => {
    const v = await store.get(versionKey)
    return typeof v === 'number' ? v : 0
  }
  const bumpVersion = async (): Promise<void> => {
    // Use store.increment when available (atomic on Redis via INCR; race-free on
    // InMemoryCacheStore because Node.js is single-threaded). Fall back to a non-atomic
    // read-then-write only when the store does not expose increment — acceptable for
    // custom single-process stores where concurrent writes cannot interleave.
    if (store.increment) {
      await store.increment(versionKey)
    } else {
      await store.set(versionKey, (await readVersion()) + 1)
    }
  }
  const keyFor = async (op: string, payload: unknown): Promise<string> =>
    `${namespace}:v${await readVersion()}:${op}:${stableStringify(payload)}`

  const cachedRead = async <T>(op: string, payload: unknown, run: () => Promise<T>): Promise<T> => {
    const key = await keyFor(op, payload)
    // A cache-bust request skips the lookup and force-refreshes the entry.
    if (!bust) {
      const hit = await store.get(key)
      if (hit !== undefined) return hit as T
    }
    const value = await run()
    await store.set(key, value, ttlSeconds)
    return value
  }

  const wrapped: Repository<TRecord, TCreate, TUpdate> = {
    ...(repo.capabilities ? { capabilities: repo.capabilities } : {}),

    getOne(id, getOptions) {
      return cachedRead('getOne', { id, getOptions }, () => repo.getOne(id, getOptions))
    },
    getMany(listOptions?: ListOptions): Promise<ListResult<TRecord>> {
      return cachedRead('getMany', listOptions ?? {}, () => repo.getMany(listOptions))
    },
    async createOne(data: TCreate) {
      const result = await repo.createOne(data)
      await bumpVersion()
      return result
    },
    async createMany(data: TCreate[]) {
      const result = await repo.createMany(data)
      await bumpVersion()
      return result
    },
    async updateOne(id, data) {
      const result = await repo.updateOne(id, data)
      await bumpVersion()
      return result
    },
    async deleteOne(id) {
      const result = await repo.deleteOne(id)
      await bumpVersion()
      return result
    }
  }

  // Optional methods: only expose (and invalidate) when the underlying repository has them,
  // so the router's `if (!repo.x)` capability checks behave identically to an uncached repo.
  if (repo.executeQuery) {
    wrapped.executeQuery = (query: IQueryOptions): Promise<QueryResult<TRecord>> =>
      cachedRead('query', query, () => repo.executeQuery!(query))
  }
  if (repo.updateMany) {
    wrapped.updateMany = async (query, data) => {
      const result = await repo.updateMany!(query, data)
      await bumpVersion()
      return result
    }
  }
  if (repo.upsertOne) {
    wrapped.upsertOne = async (id, data) => {
      const result = await repo.upsertOne!(id, data)
      await bumpVersion()
      return result
    }
  }
  if (repo.deleteMany) {
    wrapped.deleteMany = async (query) => {
      const result = await repo.deleteMany!(query)
      await bumpVersion()
      return result
    }
  }
  if (repo.withScope) {
    wrapped.withScope = (scope: TenantScope): Repository<TRecord, TCreate, TUpdate> =>
      createCachingRepository(repo.withScope!(scope), {
        store,
        ttlSeconds,
        bust,
        namespace: `${namespace}:${String(scope.value)}`
      })
  }

  return wrapped
}
