import type { CacheStore } from '../CacheStore.js'
import type { RedisLikeClient } from './RedisLikeClient.js'

/**
 * A {@link CacheStore} backed by Redis, for sharing cache and invalidation across processes
 * and instances. Values are JSON-serialised; TTL maps to Redis `EX` (a TTL of `0`/omitted
 * stores the key with no expiry).
 *
 * ```ts
 * import { createClient } from 'redis'
 * const client = createClient({ url: process.env.REDIS_URL })
 * await client.connect()
 * const store = new RedisCacheStore(client, { keyPrefix: 'halifax:' })
 * ```
 */
export class RedisCacheStore implements CacheStore {
  private readonly prefix: string

  /**
   * @param client - A connected Redis client matching {@link RedisLikeClient}.
   * @param options - Optional `keyPrefix` prepended to every key (namespacing a shared Redis).
   */
  public constructor(
    private readonly client: RedisLikeClient,
    options: { keyPrefix?: string } = {}
  ) {
    this.prefix = options.keyPrefix ?? ''
  }

  public async get(key: string): Promise<unknown> {
    const raw = await this.client.get(this.prefix + key)
    if (raw === null || raw === undefined) return undefined
    return JSON.parse(raw)
  }

  public async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value)
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(this.prefix + key, payload, { EX: ttlSeconds })
    } else {
      await this.client.set(this.prefix + key, payload)
    }
  }

  public async delete(key: string): Promise<void> {
    await this.client.del(this.prefix + key)
  }
}
