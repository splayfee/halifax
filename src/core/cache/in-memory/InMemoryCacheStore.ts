import type { CacheStore } from '../CacheStore.js'

/** A cached entry plus its absolute expiry timestamp (ms epoch), or `null` for no expiry. */
interface InMemoryEntry {
  value: unknown
  expiresAt: number | null
}

/**
 * Default in-process {@link CacheStore} backed by a `Map`, with per-entry TTL.
 *
 * Suitable for single-process deployments and tests. For multi-instance deployments,
 * inject a shared store (e.g. `RedisCacheStore`) instead so cache and invalidation are
 * consistent across processes.
 */
export class InMemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, InMemoryEntry>()

  /**
   * @param now - Clock function (ms epoch). Injectable for tests; defaults to `Date.now`.
   */
  public constructor(private readonly now: () => number = () => Date.now()) {}

  public get(key: string): unknown {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.map.delete(key)
      return undefined
    }
    return entry.value
  }

  public set(key: string, value: unknown, ttlSeconds?: number): void {
    const expiresAt = ttlSeconds && ttlSeconds > 0 ? this.now() + ttlSeconds * 1000 : null
    this.map.set(key, { value, expiresAt })
  }

  public delete(key: string): void {
    this.map.delete(key)
  }
}
