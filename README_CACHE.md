# Caching

Halifax can serve reads from a **pluggable read-through cache**. It sits at the repository
layer — _below_ the router's auth checks — so every request is still authenticated and
authorized; only the database round-trip is skipped. Writes automatically invalidate the
cache, and clients can force a refresh with a header.

- **Read-through**: `getOne`, `getMany`, and the query-builder route are cached.
- **Auto-invalidation**: any write (`create`/`update`/`upsert`/`delete`, single or bulk) to a
  resource instantly invalidates that resource's cached reads.
- **Tenant-safe**: cache keys embed the tenant scope, so one tenant can never read another's
  cached rows.
- **Pluggable store**: in-memory by default; ship a Redis (or any) store by implementing a
  tiny interface.
- **Never-expire** option and a **cache-bust header** for on-demand refresh.

## Enabling caching

Turn it on per-resource, or set an API-wide default. Per-resource config wins.

```ts
import { createExpressCrudRouter, InMemoryCacheStore } from '@edium/halifax'

// Per-resource:
const countryResource: ResourceDefinition = {
  name: 'Country',
  routePrefix: 'countries',
  fields: [{ name: 'id' }, { name: 'name', filterable: true }],
  cache: { ttlSeconds: 300 }, // cache reads for 5 minutes
  repository: countryRepo
}

// …or an API-wide default applied to every resource:
createExpressCrudRouter([countryResource, postResource], {
  cache: { ttlSeconds: 60 }
})
```

| Setting                    | Meaning                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `cache: { ttlSeconds: N }` | Cache reads for `N` seconds (per resource).                                    |
| `cache: { ttlSeconds: 0 }` | **Never expire** — cache forever (until a write invalidates it).               |
| `cache: false`             | Disable caching for this resource even when an API-wide default is set.        |
| _(omitted)_                | Inherit the API-wide `cache.ttlSeconds` default, if any; otherwise no caching. |

### Lookup tables (a common use case)

Reference/lookup tables — countries, categories, currencies — are read constantly and change
rarely, so they are the ideal cache target. Cache them **forever** and let writes invalidate:

```ts
const categoryResource: ResourceDefinition = {
  name: 'Category',
  routePrefix: 'categories',
  fields: [{ name: 'id' }, { name: 'name', filterable: true, writable: true }],
  cache: { ttlSeconds: 0 }, // never expire — refreshed only when a category is written
  repository: categoryRepo
}
```

## In-memory store (default)

When you enable caching without supplying a store, Halifax uses an in-process
`InMemoryCacheStore`. It's perfect for a single instance and for tests, with no dependencies:

```ts
import { createExpressCrudRouter, InMemoryCacheStore } from '@edium/halifax'

createExpressCrudRouter(resources, {
  cache: { ttlSeconds: 60, store: new InMemoryCacheStore() } // store is optional here
})
```

> For multi-instance deployments use a shared store (below) so the cache and its invalidation
> are consistent across processes.

## Redis store

`RedisCacheStore` wraps any Redis client matching a tiny duck-typed interface
(`get` / `set(key, value, { EX })` / `del`) — the [`redis`](https://www.npmjs.com/package/redis)
v4 client matches it directly, so Halifax doesn't depend on a specific Redis package.

```ts
import { createClient } from 'redis'
import { createExpressCrudRouter, RedisCacheStore } from '@edium/halifax'

const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

createExpressCrudRouter(resources, {
  cache: {
    ttlSeconds: 300,
    store: new RedisCacheStore(redis, { keyPrefix: 'halifax:' }) // keyPrefix is optional
  }
})
```

Values are JSON-serialised; a TTL of `0` stores the key with no Redis expiry (never-expire).
The optional `keyPrefix` namespaces a shared Redis instance.

## Busting the cache (force refresh)

A client can bypass the cache for a single request with a header. By default Halifax honours
the standard **`Cache-Control: no-cache`** (or `no-store`) request header:

```bash
curl https://api.example.com/api/countries -H 'Cache-Control: no-cache'
```

That request reads fresh from the database **and** repopulates the cache, so subsequent
requests are fast again. Writes still invalidate the cache on their own — busting is only for
on-demand reads.

Use a custom header instead via `cache.bustHeader`; with a custom header, the cache busts
whenever the header is present with any non-empty value:

```ts
createExpressCrudRouter(resources, {
  cache: { ttlSeconds: 60, bustHeader: 'X-Cache-Bust' }
})
```

```bash
curl https://api.example.com/api/countries -H 'X-Cache-Bust: 1'
```

## How invalidation works

Each resource (per tenant) has a version counter in the store. Cached read keys embed the
current version; a write bumps the version, so all previously-cached reads for that
resource/tenant are instantly unreachable and fall out by TTL. There is no key scanning, which
keeps invalidation cheap on Redis.

## Custom store

Implement the `CacheStore` interface to back the cache with anything (Memcached, a CDN KV,
etc.):

```ts
import type { CacheStore } from '@edium/halifax'

class MyCacheStore implements CacheStore {
  async get(key: string): Promise<unknown> {
    /* … */
  }
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    /* TTL of 0/undefined = no expiry */
  }
  async delete(key: string): Promise<void> {
    /* … */
  }
  // Optional — implement for atomic version bumps under concurrent writes.
  // When omitted, Halifax falls back to a non-atomic GET + SET (safe for
  // single-process stores like InMemoryCacheStore, but not for Redis).
  async increment(key: string): Promise<number> {
    /* … return new integer value */
  }
}
```

You can also wrap a repository directly with `createCachingRepository(repo, { store, ttlSeconds, namespace })`
if you need caching outside the HTTP layer.

## Testing

- **Unit** (`pnpm test:unit`) — `InMemoryCacheStore`, the caching decorator, and the
  `Cache-Control` header wiring are covered with no external services.
- **Integration** (`pnpm test:integration`) — a Redis-backed lookup-table scenario runs
  against a real Redis container (set `REDIS_URL`), proving cache hits, never-expire, key
  presence, header busting, and write invalidation. CI runs it on a `redis:7` service.
