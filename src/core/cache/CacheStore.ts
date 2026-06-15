/**
 * Pluggable cache backend. The default is `InMemoryCacheStore`; supply your own
 * (Redis, Memcached, etc.) via the API's cache options to share a cache across processes.
 * All methods may be async so network-backed stores fit the same contract.
 */
export interface CacheStore {
  /**
   * Read a cached value.
   * @param key - Cache key.
   * @returns The stored value, or `undefined` when absent or expired.
   */
  get(key: string): Promise<unknown> | unknown
  /**
   * Write a cached value.
   * @param key - Cache key.
   * @param value - Value to store.
   * @param ttlSeconds - Time-to-live in seconds. Omit/`undefined` (or `0`) for no expiry.
   */
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void> | void
  /**
   * Delete a cached value.
   * @param key - Cache key to remove.
   */
  delete(key: string): Promise<void> | void
  /**
   * Atomically increment an integer counter and return the new value.
   * When the key does not exist, it is initialised to `0` before incrementing.
   *
   * Implementing this method is **strongly recommended** for multi-process stores
   * (e.g. Redis) — without it, `createCachingRepository` falls back to a non-atomic
   * read-then-write version-bump that can lose invalidations under concurrent writes.
   *
   * Single-process stores (`InMemoryCacheStore`) can implement this synchronously and
   * are immune to the race regardless, but should still implement it for correctness.
   */
  increment?(key: string): Promise<number> | number
}
