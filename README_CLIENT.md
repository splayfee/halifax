# @edium/halifax-client

Typed browser/Node client for `@edium/halifax` APIs. Ships a fluent query builder, built-in TanStack Query option factories, and five pluggable HTTP transports.

## Install

```bash
pnpm add @edium/halifax-client
```

TanStack Query is a peer dependency — add whichever adapter your framework uses:

```bash
# React
pnpm add @tanstack/react-query

# Vue
pnpm add @tanstack/vue-query
```

## Quick Start

```ts
import { HalifaxClient } from '@edium/halifax-client'

const client = new HalifaxClient({ baseUrl: 'https://api.example.com/v1' })

// Typed resource client
interface Post {
  id: number
  title: string
  content: string
  published: boolean
}
const posts = client.resource<Post, Omit<Post, 'id'>, Partial<Omit<Post, 'id'>>>('posts')

// CRUD
const post = await posts.getOne(1)
const { results, count } = await posts.getMany({ limit: 20, offset: 0 })
const created = await posts.createOne({ title: 'Hello', content: '...', published: false })
const updated = await posts.updateOne(1, { published: true })
await posts.deleteOne(1)
```

## HalifaxClient Options

```ts
const client = new HalifaxClient({
  baseUrl: 'https://api.example.com/v1',

  // Static or async headers (auth, correlation-id, etc.)
  headers: async () => ({ Authorization: `Bearer ${await getToken()}` }),

  // Envelope key — strip a response wrapper before returning data
  // (mirrors the server's `envelope` option)
  envelope: 'data',

  // Path segment for POST-to-query routes (default: 'query')
  queryBuilderPath: 'query'

  // Swap the HTTP transport (default: fetch)
  // transport: new AxiosTransport(axiosInstance),
})
```

## HTTP Transports

The client ships five adapters. Each wraps its library's native request, translating it to the internal `HttpTransport` interface. Pass one via `options.transport`.

| Transport             | Library           | Import                     |
| --------------------- | ----------------- | -------------------------- |
| `FetchTransport`      | `fetch` (default) | built-in, no import needed |
| `AxiosTransport`      | `axios`           | `@edium/halifax-client`    |
| `KyTransport`         | `ky`              | `@edium/halifax-client`    |
| `OfetchTransport`     | `ofetch`          | `@edium/halifax-client`    |
| `SuperagentTransport` | `superagent`      | `@edium/halifax-client`    |

```ts
import axios from 'axios'
import { AxiosTransport } from '@edium/halifax-client'

const axiosInstance = axios.create({ timeout: 10_000 })
const client = new HalifaxClient({
  baseUrl: 'https://api.example.com/v1',
  transport: new AxiosTransport(axiosInstance)
})
```

You can also supply a custom fetch function (e.g. one with retry logic or a custom timeout):

```ts
import { HalifaxClient } from '@edium/halifax-client'

const client = new HalifaxClient({
  baseUrl: 'https://api.example.com/v1',
  fetch: myCustomFetch // replaces globalThis.fetch inside FetchTransport
})
```

## Query Builder

Chain conditions, sorting, and pagination before sending them to the `POST /<resource>/query` endpoint.

```ts
import { QueryBuilder, SqlComparison, SqlOrder } from '@edium/halifax-client'

const q = new QueryBuilder()
  .where('published', SqlComparison.Equal, true)
  .and('authorId', SqlComparison.Equal, 42)
  .orderBy('createdAt', SqlOrder.DESC)
  .limit(20)
  .offset(0)

const { results, count } = await posts.query(q)
```

### Boolean groups

```ts
// WHERE status = 'active' AND (role = 'admin' OR role = 'editor')
const q = new QueryBuilder()
  .where('status', SqlComparison.Equal, 'active')
  .andGroup('role', SqlComparison.Equal, 'admin', (b) =>
    b.or('role', SqlComparison.Equal, 'editor')
  )
```

### Bulk update / delete

```ts
// PATCH /posts — update all published posts
await posts.updateMany(new QueryBuilder().where('published', SqlComparison.Equal, true), {
  published: false
})

// DELETE /posts — delete all drafts older than a date
await posts.deleteMany(
  new QueryBuilder()
    .where('published', SqlComparison.Equal, false)
    .and('createdAt', SqlComparison.LessThan, '2024-01-01')
)
```

## TanStack Query — React

Install:

```bash
pnpm add @tanstack/react-query
```

`ResourceClient` exposes three option factories — `getManyOptions`, `getOneOptions`, and `queryOptions` — that return `{ queryKey, queryFn }` objects compatible with TanStack Query's `useQuery` hook.

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HalifaxClient, QueryBuilder, SqlComparison } from '@edium/halifax-client'

interface Post {
  id: number
  title: string
  content: string
  published: boolean
}

const client = new HalifaxClient({ baseUrl: '/api/v1' })
const posts = client.resource<Post, Omit<Post, 'id'>, Partial<Omit<Post, 'id'>>>('posts')

// ─── List ────────────────────────────────────────────────────────────────────

function PostList() {
  const { data, isLoading } = useQuery(posts.getManyOptions({ limit: 20 }))

  if (isLoading) return <p>Loading…</p>
  return (
    <ul>
      {data?.results.map((p) => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  )
}

// ─── Detail ──────────────────────────────────────────────────────────────────

function PostDetail({ id }: { id: number }) {
  const { data, isLoading } = useQuery(posts.getOneOptions(id))

  if (isLoading) return <p>Loading…</p>
  return (
    <article>
      <h1>{data?.title}</h1>
      <p>{data?.content}</p>
    </article>
  )
}

// ─── Advanced query ───────────────────────────────────────────────────────────

function PublishedPosts() {
  const q = new QueryBuilder()
    .where('published', SqlComparison.Equal, true)
    .orderBy('title')
    .limit(10)

  const { data } = useQuery(posts.queryOptions(q))

  return (
    <ul>
      {data?.results.map((p) => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  )
}

// ─── Paginated list ───────────────────────────────────────────────────────────

function PaginatedPosts() {
  const [page, setPage] = React.useState(0)
  const PAGE_SIZE = 20

  const { data } = useQuery(posts.getManyOptions({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }))

  return (
    <>
      <ul>
        {data?.results.map((p) => (
          <li key={p.id}>{p.title}</li>
        ))}
      </ul>
      <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
        Prev
      </button>
      <button onClick={() => setPage((p) => p + 1)}>Next</button>
    </>
  )
}

// ─── Create mutation with cache invalidation ──────────────────────────────────

function CreatePost() {
  const queryClient = useQueryClient()
  const [title, setTitle] = React.useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: (data: Omit<Post, 'id'>) => posts.createOne(data),
    onSuccess: () => {
      // Invalidate all list queries for this resource at once
      void queryClient.invalidateQueries({ queryKey: ['posts'] })
    }
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mutate({ title, content: '', published: false })
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit" disabled={isPending}>
        Create
      </button>
    </form>
  )
}

// ─── Update mutation ──────────────────────────────────────────────────────────

function PublishPost({ id }: { id: number }) {
  const queryClient = useQueryClient()

  const { mutate } = useMutation({
    mutationFn: () => posts.updateOne(id, { published: true }),
    onSuccess: (updated) => {
      // Update the detail cache entry directly (avoids a refetch)
      queryClient.setQueryData(posts.detailKey(id), updated)
      // Also bust any list caches
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] })
    }
  })

  return <button onClick={() => mutate()}>Publish</button>
}
```

### Query key hierarchy

The key factories follow a three-tier hierarchy so broad invalidation is easy:

| Key                               | Returned by       |
| --------------------------------- | ----------------- |
| `['posts']`                       | top-level prefix  |
| `['posts', 'list', params]`       | `listKey(params)` |
| `['posts', 'detail', id, params]` | `detailKey(id)`   |
| `['posts', 'query', queryAST]`    | `queryKey(q)`     |

`queryClient.invalidateQueries({ queryKey: ['posts'] })` busts **all** lists, details, and query results for the resource in one call.

## TanStack Query — Vue

Install:

```bash
pnpm add @tanstack/vue-query
```

Wire up the plugin once at application startup:

```ts
// main.ts
import { createApp } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'

createApp(App).use(VueQueryPlugin).mount('#app')
```

Then use the option factories in your components. Vue Query requires the options to be reactive — wrap them in `computed()` when any parameter comes from reactive state:

```vue
<!-- PostList.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { HalifaxClient, QueryBuilder, SqlComparison } from '@edium/halifax-client'

interface Post {
  id: number
  title: string
  content: string
  published: boolean
}

const client = new HalifaxClient({ baseUrl: '/api/v1' })
const posts = client.resource<Post, Omit<Post, 'id'>, Partial<Omit<Post, 'id'>>>('posts')

// ─── Static options (no reactive params) ─────────────────────────────────────

const { data: allPosts, isLoading } = useQuery(posts.getManyOptions({ limit: 20 }))

// ─── Reactive params — wrap in computed() ────────────────────────────────────

const page = ref(0)
const PAGE_SIZE = 20

const { data: pagedPosts } = useQuery(
  computed(() => posts.getManyOptions({ limit: PAGE_SIZE, offset: page.value * PAGE_SIZE }))
)
</script>

<template>
  <p v-if="isLoading">Loading…</p>
  <ul v-else>
    <li v-for="p in allPosts?.results" :key="p.id">{{ p.title }}</li>
  </ul>

  <ul>
    <li v-for="p in pagedPosts?.results" :key="p.id">{{ p.title }}</li>
  </ul>
  <button :disabled="page === 0" @click="page--">Prev</button>
  <button @click="page++">Next</button>
</template>
```

```vue
<!-- PostDetail.vue -->
<script setup lang="ts">
import { toRef } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { HalifaxClient } from '@edium/halifax-client'

interface Post {
  id: number
  title: string
  content: string
}

const props = defineProps<{ id: number }>()

const client = new HalifaxClient({ baseUrl: '/api/v1' })
const posts = client.resource<Post>('posts')

// toRef keeps the query key reactive when the prop changes
const { data: post } = useQuery(computed(() => posts.getOneOptions(props.id)))
</script>

<template>
  <article v-if="post">
    <h1>{{ post.title }}</h1>
    <p>{{ post.content }}</p>
  </article>
</template>
```

```vue
<!-- CreatePost.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { HalifaxClient } from '@edium/halifax-client'

interface Post {
  id: number
  title: string
  content: string
  published: boolean
}

const client = new HalifaxClient({ baseUrl: '/api/v1' })
const posts = client.resource<Post, Omit<Post, 'id'>, Partial<Omit<Post, 'id'>>>('posts')

const queryClient = useQueryClient()
const title = ref('')

const { mutate, isPending } = useMutation({
  mutationFn: (data: Omit<Post, 'id'>) => posts.createOne(data),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ['posts'] })
  }
})

function submit() {
  mutate({ title: title.value, content: '', published: false })
}
</script>

<template>
  <form @submit.prevent="submit">
    <input v-model="title" />
    <button type="submit" :disabled="isPending">Create</button>
  </form>
</template>
```

```vue
<!-- AdvancedQuery.vue — query builder + reactive params -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { HalifaxClient, QueryBuilder, SqlComparison, SqlOrder } from '@edium/halifax-client'

interface Post {
  id: number
  title: string
  published: boolean
}

const client = new HalifaxClient({ baseUrl: '/api/v1' })
const posts = client.resource<Post>('posts')

const publishedOnly = ref(true)

// The query rebuilds reactively when publishedOnly changes
const { data } = useQuery(
  computed(() => {
    const q = new QueryBuilder().orderBy('title', SqlOrder.ASC).limit(10)
    if (publishedOnly.value) q.where('published', SqlComparison.Equal, true)
    return posts.queryOptions(q)
  })
)
</script>

<template>
  <label> <input v-model="publishedOnly" type="checkbox" /> Published only </label>
  <ul>
    <li v-for="p in data?.results" :key="p.id">{{ p.title }}</li>
  </ul>
</template>
```

## Error Handling

Failed requests throw `HalifaxError`. It carries the HTTP status code and the structured error array from the server:

```ts
import { HalifaxError } from '@edium/halifax-client'

try {
  await posts.getOne(999)
} catch (err) {
  if (err instanceof HalifaxError) {
    console.log(err.status) // 404
    console.log(err.errors[0].code) // 'NOT_FOUND'
    console.log(err.errors[0].message)
  }
}
```

In React Query, errors surface through the `error` field:

```tsx
const { data, error } = useQuery(posts.getOneOptions(id))
if (error instanceof HalifaxError && error.status === 404) {
  return <p>Post not found</p>
}
```

## API Reference

### `HalifaxClient`

| Method                                          | Description                                                 |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `resource<TRecord, TCreate?, TUpdate?>(prefix)` | Returns a typed `ResourceClient` for the given route prefix |

### `ResourceClient<TRecord, TCreate, TUpdate>`

**CRUD**

| Method       | Signature       | HTTP                 |
| ------------ | --------------- | -------------------- |
| `getOne`     | `(id, params?)` | `GET /prefix/:id`    |
| `getMany`    | `(params?)`     | `GET /prefix`        |
| `createOne`  | `(data)`        | `POST /prefix`       |
| `createMany` | `(data[])`      | `POST /prefix`       |
| `updateOne`  | `(id, data)`    | `PATCH /prefix/:id`  |
| `updateMany` | `(query, data)` | `PATCH /prefix`      |
| `upsertOne`  | `(id, data)`    | `PUT /prefix/:id`    |
| `deleteOne`  | `(id)`          | `DELETE /prefix/:id` |
| `deleteMany` | `(query)`       | `DELETE /prefix`     |
| `query`      | `(query)`       | `POST /prefix/query` |

**Query key helpers**

| Method                   | Returns                                  |
| ------------------------ | ---------------------------------------- |
| `listKey(params?)`       | `['prefix', 'list', params \| {}]`       |
| `detailKey(id, params?)` | `['prefix', 'detail', id, params \| {}]` |
| `queryKey(query)`        | `['prefix', 'query', queryAST]`          |

**TanStack Query option factories**

| Method                       | Returns                                |
| ---------------------------- | -------------------------------------- |
| `getManyOptions(params?)`    | `{ queryKey, queryFn }` for `useQuery` |
| `getOneOptions(id, params?)` | `{ queryKey, queryFn }` for `useQuery` |
| `queryOptions(query)`        | `{ queryKey, queryFn }` for `useQuery` |

### `QueryBuilder`

| Method                                       | Description                     |
| -------------------------------------------- | ------------------------------- |
| `where(field, comparison, value1?, value2?)` | First WHERE condition           |
| `and(field, comparison, value1?, value2?)`   | Append AND condition            |
| `or(field, comparison, value1?, value2?)`    | Append OR condition             |
| `andGroup(field, comparison, value1, fn)`    | Parenthesized AND group         |
| `orGroup(field, comparison, value1, fn)`     | Parenthesized OR group          |
| `orderBy(field, direction?)`                 | Add ORDER BY (default ASC)      |
| `limit(n)`                                   | Maximum records to return       |
| `offset(n)`                                  | Records to skip                 |
| `select(...fields)`                          | Project specific fields         |
| `distinct(...fields)`                        | Deduplicate on these columns    |
| `build()`                                    | Produce the `IQueryOptions` AST |
