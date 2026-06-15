/**
 * The slice of a Redis client {@link RedisCacheStore} uses. It is intentionally tiny and
 * duck-typed so any client matching it works (`redis` v4, etc.) without Halifax depending on
 * a specific Redis package. (`redis` v4: `get` / `set(key, val, { EX })` / `del` all match.)
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>
  del(key: string): Promise<unknown>
  /** Atomic integer increment — maps to Redis `INCR`. Optional but strongly recommended. */
  incr?(key: string): Promise<number>
}
