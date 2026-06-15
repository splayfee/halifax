import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RedisCacheStore } from '@/core/cache/redis/RedisCacheStore.js'
import type { RedisLikeClient } from '@/core/cache/redis/RedisLikeClient.js'

function makeClient(): RedisLikeClient & {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
} {
  return {
    get: vi.fn<(key: string) => Promise<string | null>>().mockResolvedValue(null),
    set: vi
      .fn<(key: string, value: string, options?: { EX?: number }) => Promise<void>>()
      .mockResolvedValue(undefined),
    del: vi.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined)
  }
}

describe('RedisCacheStore', () => {
  let client: ReturnType<typeof makeClient>
  let store: RedisCacheStore

  beforeEach(() => {
    client = makeClient()
    store = new RedisCacheStore(client)
  })

  describe('get', () => {
    it('returns undefined when the key is absent (client returns null)', async () => {
      client.get.mockResolvedValue(null)
      expect(await store.get('missing')).toBeUndefined()
    })

    it('returns the parsed value when the key exists', async () => {
      client.get.mockResolvedValue(JSON.stringify({ a: 1 }))
      expect(await store.get('k')).toEqual({ a: 1 })
    })

    it('deserialises primitive types correctly', async () => {
      client.get.mockResolvedValueOnce('42')
      expect(await store.get('num')).toBe(42)

      client.get.mockResolvedValueOnce('"hello"')
      expect(await store.get('str')).toBe('hello')

      client.get.mockResolvedValueOnce('true')
      expect(await store.get('bool')).toBe(true)
    })

    it('forwards the key to the redis client (no prefix by default)', async () => {
      await store.get('mykey')
      expect(client.get).toHaveBeenCalledWith('mykey')
    })

    it('prepends the key prefix', async () => {
      const prefixed = new RedisCacheStore(client, { keyPrefix: 'app:' })
      await prefixed.get('x')
      expect(client.get).toHaveBeenCalledWith('app:x')
    })
  })

  describe('set', () => {
    it('serialises the value to JSON and calls client.set', async () => {
      await store.set('k', { hello: 'world' })
      expect(client.set).toHaveBeenCalledWith('k', JSON.stringify({ hello: 'world' }))
    })

    it('passes EX option when ttlSeconds > 0', async () => {
      await store.set('k', 'v', 30)
      expect(client.set).toHaveBeenCalledWith('k', '"v"', { EX: 30 })
    })

    it('omits EX option when ttlSeconds is 0 (cache forever)', async () => {
      await store.set('k', 'v', 0)
      expect(client.set).toHaveBeenCalledWith('k', '"v"')
    })

    it('omits EX option when ttlSeconds is undefined', async () => {
      await store.set('k', 'v')
      expect(client.set).toHaveBeenCalledWith('k', '"v"')
    })

    it('prepends the key prefix', async () => {
      const prefixed = new RedisCacheStore(client, { keyPrefix: 'ns:' })
      await prefixed.set('k', 1, 10)
      expect(client.set).toHaveBeenCalledWith('ns:k', '1', { EX: 10 })
    })
  })

  describe('delete', () => {
    it('calls client.del with the key', async () => {
      await store.delete('k')
      expect(client.del).toHaveBeenCalledWith('k')
    })

    it('prepends the key prefix', async () => {
      const prefixed = new RedisCacheStore(client, { keyPrefix: 'ns:' })
      await prefixed.delete('k')
      expect(client.del).toHaveBeenCalledWith('ns:k')
    })
  })
})
