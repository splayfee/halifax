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
 *
 * Expired entries are lazily evicted on reads. To prevent unbounded accumulation under
 * write-heavy workloads, a sweep of all expired entries runs automatically every
 * `sweepEvery` writes (default: 200). Adjust via the constructor option.
 */
export class InMemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, InMemoryEntry>()
  private setCount = 0
  private readonly sweepEvery: number

  /**
   * @param now - Clock function (ms epoch). Injectable for tests; defaults to `Date.now`.
   * @param sweepEvery - Run a full expired-entry sweep every N `set` calls. Defaults to 200.
   */
  public constructor(
    private readonly now: () => number = () => Date.now(),
    sweepEvery = 200
  ) {
    this.sweepEvery = sweepEvery
  }

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
    if (++this.setCount % this.sweepEvery === 0) this.purgeExpired()
  }

  public delete(key: string): void {
    this.map.delete(key)
  }

  /**
   * Atomically increments an integer counter and returns the new value.
   * Because Node.js is single-threaded this is race-free without a lock.
   */
  public increment(key: string): number {
    const entry = this.map.get(key)
    const current = typeof entry?.value === 'number' ? entry.value : 0
    const next = current + 1
    this.map.set(key, { value: next, expiresAt: null })
    return next
  }

  private purgeExpired(): void {
    const now = this.now()
    for (const [key, entry] of this.map) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.map.delete(key)
    }
  }
}
