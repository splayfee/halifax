# Repositories

A repository is the data-access layer Halifax talks to. All adapters implement the same `Repository` interface, so you can swap ORM/database without touching your routes or auth.

## The Repository Interface

```ts
interface Repository<TRecord, TCreate, TUpdate> {
  readonly capabilities?: Partial<RepositoryCapabilities>

  getOne(
    id: string | number,
    options?: { fields?: string[]; include?: string[] }
  ): Promise<TRecord | null>
  getMany(options?: ListOptions): Promise<ListResult<TRecord>>
  createOne(data: TCreate): Promise<TRecord>
  createMany(data: TCreate[]): Promise<TRecord[]>
  updateOne(id: string | number, data: TUpdate): Promise<TRecord | null>
  deleteOne(id: string | number): Promise<boolean>

  // Optional bulk / query-builder operations (PrismaAdapter implements all three)
  updateMany?(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>>
  deleteMany?(query: IQueryOptions): Promise<DeleteManyResult>
  executeQuery?(query: IQueryOptions): Promise<QueryResult<TRecord>>
}
```

## Repository Capabilities

Repositories declare what they support through a `capabilities` property. Read it to make runtime decisions without guessing:

```ts
interface RepositoryCapabilities {
  supportsIncludes: boolean // ORM relation loading
  supportsTransactions: boolean // transaction wrapping
  supportsCreateManyReturn: boolean // createMany returns the created records
  supportsQueryAst: boolean // executes the query-builder AST
}
```

`PrismaAdapter` implements `updateMany` / `deleteMany` / `executeQuery` for every database (they compile to portable Prisma Client calls) and reports `supportsQueryAst: true`.

## Prisma 7 Repository Adapter

### 1. Define your Prisma schema

With Prisma 7, the datasource block no longer accepts a `url` property. The URL goes in `prisma.config.ts` for CLI tools, and in a driver adapter for the runtime client.

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client-js"
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  Int?
  author    Author?  @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("posts")
}

model Author {
  id    Int    @id @default(autoincrement())
  name  String
  email String @unique
  posts Post[]

  @@map("authors")
}
```

Create `prisma.config.ts` at the project root so `prisma generate`, `prisma migrate`, and `prisma db push` can find the database URL:

```ts
// prisma.config.ts
import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: { url: process.env.DATABASE_URL }
})
```

```bash
pnpm exec prisma generate
pnpm exec prisma migrate dev --name init
```

### 2. Create the Prisma client

Prisma 7 requires a driver adapter at runtime. Install `@prisma/adapter-pg` for PostgreSQL:

```bash
pnpm add @prisma/adapter-pg pg
pnpm add -D @types/pg
```

```ts
// src/db.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg(process.env.DATABASE_URL!)
export const prisma = new PrismaClient({ adapter })
```

### 3. Create a `PrismaAdapter`

```ts
import { PrismaAdapter } from '@edium/halifax'
import type { Post, Prisma } from '@prisma/client'
import { prisma } from './db.js'

export const postRepository = new PrismaAdapter<
  Post,
  Prisma.PostCreateInput,
  Prisma.PostUpdateInput
>({
  delegate: prisma.post // no cast needed
})
```

Just the model delegate — CRUD, bulk operations, and the query builder all run through it.

#### Options

| Option          | Type      | Required | Description                                                          |
| --------------- | --------- | -------- | -------------------------------------------------------------------- |
| `delegate`      | `any`     | yes      | The Prisma model delegate (`prisma.post`, `prisma.user`, …)          |
| `idField`       | `string`  | no       | Primary key field name (default: `"id"`)                             |
| `returnCreated` | `boolean` | no       | When `true`, `createMany` returns created records (default: `false`) |

#### `createMany` and returned records

By default, `createMany` uses Prisma's bulk insert for efficiency but returns an empty array because Prisma's `createMany` does not return the created rows. Set `returnCreated: true` to fall back to serial `createOne` calls and receive the full records:

```ts
new PrismaAdapter({
  delegate: prisma.post,
  returnCreated: true // slower, but returns created records
})
```

`capabilities.supportsCreateManyReturn` reflects this setting.

### `select` vs `include`

`select` (field projection) and `include` (relation loading) are mutually exclusive in Prisma. The adapter enforces this automatically: when `fields` is specified, it builds a `select` and ignores `include`; when only `include` is specified, it builds an `include`.

## Supported Databases

The **same `PrismaAdapter`** works with every database Prisma supports — there is no adapter-per-database. All CRUD and the query builder compile to portable Prisma Client calls, so behaviour is identical across engines. To switch databases you change only the Prisma `provider` and driver adapter:

| Database        | Prisma `provider` | Driver adapter                   |
| --------------- | ----------------- | -------------------------------- |
| PostgreSQL      | `postgresql`      | `@prisma/adapter-pg`             |
| CockroachDB     | `cockroachdb`     | `@prisma/adapter-pg`             |
| MySQL / MariaDB | `mysql`           | `@prisma/adapter-mariadb`        |
| SQL Server      | `sqlserver`       | `@prisma/adapter-mssql`          |
| SQLite          | `sqlite`          | `@prisma/adapter-better-sqlite3` |
| MongoDB         | `mongodb`         | _(built-in connector)_           |

The integration suite runs unchanged against PostgreSQL, MySQL, and SQLite in CI to keep this honest; the others use the same harness (`HALIFAX_DB=<db>`).

**MongoDB note.** Mongo keys are 24-character `ObjectId` strings (`@id @default(auto()) @map("_id") @db.ObjectId`). Halifax's `:id` route validation accepts integers, UUIDs, **and** ObjectIds, so id-based routes work on Mongo out of the box.

## Targeting database Views

A database **view is just a model** to Halifax. Prisma exposes a `view` block as a delegate with the same read API as a model (`prisma.activeUsers.findMany()`), so you point a resource's repository at it and disable writes:

```ts
const activeUsersResource: ResourceDefinition = {
  name: 'ActiveUser',
  routePrefix: 'active-users',
  fields: [{ name: 'id' }, { name: 'email', filterable: true }],
  permissions: {
    allowReadOne: true,
    allowReadMany: true,
    allowReadManyWithQueryBuilder: true,
    allowCreate: false,
    allowUpdateOne: false,
    allowUpdateMany: false,
    allowUpsertOne: false,
    allowDeleteOne: false,
    allowDeleteMany: false
  },
  repository: new PrismaAdapter({ delegate: prisma.activeUsers })
}
```

No adapter changes are needed — reads, filtering, sorting, pagination, and the query builder all work against the view. (Drizzle views behave the same way.)

## Caching

Any resource can be served through a pluggable read-through cache (in-memory or Redis), with
per-resource TTLs, a never-expire mode, automatic write-invalidation, tenant-safe keys, and a
cache-bust header:

```ts
const postResource: ResourceDefinition = {
  /* … */
  cache: { ttlSeconds: 60 } // cache reads for 60s; writes invalidate automatically
}
```

See **[README_CACHE.md](./README_CACHE.md)** for in-memory and Redis examples, the
never-expire (`ttlSeconds: 0`) and `cache: false` options, and the `Cache-Control: no-cache`
bust header.

## Implementing a Custom Repository

Any class or object that satisfies the `Repository` interface works:

```ts
import type { Repository, ListResult } from '@edium/halifax'

export class InMemoryRepository<T extends { id: number }> implements Repository<
  T,
  Omit<T, 'id'>,
  Partial<T>
> {
  private records: T[] = []
  private nextId = 1

  async getOne(id: string | number) {
    return this.records.find((r) => r.id === Number(id)) ?? null
  }

  async getMany(): Promise<ListResult<T>> {
    return { count: this.records.length, results: [...this.records] }
  }

  async createOne(data: Omit<T, 'id'>) {
    const record = { id: this.nextId++, ...data } as T
    this.records.push(record)
    return record
  }

  async createMany(data: Omit<T, 'id'>[]) {
    return Promise.all(data.map((d) => this.createOne(d)))
  }

  async updateOne(id: string | number, data: Partial<T>) {
    const record = this.records.find((r) => r.id === Number(id))
    if (!record) return null
    Object.assign(record, data)
    return record
  }

  async deleteOne(id: string | number) {
    const idx = this.records.findIndex((r) => r.id === Number(id))
    if (idx === -1) return false
    this.records.splice(idx, 1)
    return true
  }
}
```
