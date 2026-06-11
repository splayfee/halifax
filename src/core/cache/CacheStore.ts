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
}
