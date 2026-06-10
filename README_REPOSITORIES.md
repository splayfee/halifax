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

  // Optional — requires native SQL support (client + tableName)
  updateMany?(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>>
  deleteMany?(query: IQueryOptions): Promise<DeleteManyResult>
  executeQueryBuilder?(query: IQueryOptions): Promise<NativeQueryResult<TRecord>>
}
```

## Repository Capabilities

Repositories declare what they support through a `capabilities` property. Read it to make runtime decisions without guessing:

```ts
interface RepositoryCapabilities {
  supportsNativeSql: boolean // raw SQL via client.$queryRawUnsafe
  supportsIncludes: boolean // ORM relation loading
  supportsTransactions: boolean // transaction wrapping
  supportsCreateManyReturn: boolean // createMany returns the created records
  supportsNoSqlQueryAst: boolean // non-SQL query AST (e.g. MongoDB)
}
```

```ts
if (repo.capabilities?.supportsNativeSql) {
  // safe to call executeQueryBuilder / updateMany / deleteMany
}
```

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

### 3. Create a `PrismaRepositoryAdapter`

```ts
import { PrismaRepositoryAdapter } from '@edium/halifax'
import type { Post, Prisma } from '@prisma/client'
import { prisma } from './db.js'

export const postRepository = new PrismaRepositoryAdapter<
  Post,
  Prisma.PostCreateInput,
  Prisma.PostUpdateInput
>({
  delegate: prisma.post as any, // cast needed — Prisma's generated types are narrower
  client: prisma, // required for updateMany / deleteMany / executeQueryBuilder
  tableName: 'posts' // matches @@map in your schema
})
```

#### Options

| Option          | Type      | Required | Description                                                          |
| --------------- | --------- | -------- | -------------------------------------------------------------------- |
| `delegate`      | `any`     | yes      | The Prisma model delegate (`prisma.post`, `prisma.user`, …)          |
| `client`        | `Prisma`  | no       | Full `PrismaClient` instance — enables raw SQL operations            |
| `tableName`     | `string`  | no       | Table name for raw SQL; must match the `@@map` in your schema        |
| `idField`       | `string`  | no       | Primary key field name (default: `"id"`)                             |
| `returnCreated` | `boolean` | no       | When `true`, `createMany` returns created records (default: `false`) |

#### `createMany` and returned records

By default, `createMany` uses Prisma's bulk insert for efficiency but returns an empty array because Prisma's `createMany` does not return the created rows. Set `returnCreated: true` to fall back to serial `createOne` calls and receive the full records:

```ts
new PrismaRepositoryAdapter({
  delegate: prisma.post as any,
  client: prisma,
  tableName: 'posts',
  returnCreated: true // slower, but returns created records
})
```

`capabilities.supportsCreateManyReturn` reflects this setting.

### `select` vs `include`

`select` (field projection) and `include` (relation loading) are mutually exclusive in Prisma. The adapter enforces this automatically: when `fields` is specified, it builds a `select` and ignores `include`; when only `include` is specified, it builds an `include`.

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
