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
  supportsIncludes: boolean // ORM relation loading; when false the router rejects ?include= with 422
  supportsCreateManyReturn: boolean // createMany returns the created records (vs. an empty array)
}
```

`PrismaAdapter` reports `supportsIncludes: true` and `supportsCreateManyReturn: <returnCreated>`. It implements `updateMany` / `deleteMany` / `executeQuery` for every database (they compile to portable Prisma Client calls).

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

## Where does the field schema come from?

A resource always needs a field schema — it's the allow-list that powers filtering, sorting, projection, and field-level write security. There is no schemaless resource; the router throws at registration if it can't find one. The schema can come from **two places**:

1. **Derived from the model (preferred for Prisma).** When the `PrismaAdapter` knows the model, it exposes `fields`/`relations`/`idField`, and the resource can omit `fields` entirely — or list only the ones it wants to **change** (merged by name as sparse overrides). The zero-config way to get there is `createPrismaResources`, which builds a ready-to-serve resource for every model from Prisma's DMMF:

   ```ts
   import { Prisma, PrismaClient } from '@prisma/client'
   import { PrismaPg } from '@prisma/adapter-pg'
   import { createPrismaResources, createExpressCrudRouter } from '@edium/halifax'

   const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) })

   // One line → a resource per model, fields and relations derived. No `fields` arrays anywhere.
   const resources = createPrismaResources(prisma, Prisma.dmmf.datamodel.models, {
     // Optional per-model tweaks — the only place you write anything:
     models: {
       AuditLog: { permissions: { allowDeleteOne: false, allowDeleteMany: false } }
     }
   })

   app.use('/api/v1', createExpressCrudRouter(resources, { authStrategy }))
   ```

2. **Declared on the resource (for custom repositories).** A "bare" adapter — `new PrismaAdapter({ delegate })` with no model, or any **non-Prisma** `Repository` (in-memory, an external API, a different ORM) — has no schema to introspect. There, the resource's `fields` array **is** the schema, and it is required. This is the only situation where you hand-write `fields`, and it's the price of Halifax not having a model to read.

**Rule of thumb:** for Prisma, prefer `createPrismaResources` (or pass `model` to the adapter) and declare a field only to override it; reach for a hand-written `fields` array only when the repository genuinely has no schema to offer.

## Prisma 6 (also supported)

Halifax's `peerDependencies` allow `@prisma/client >=6.0.0`, so it runs on **Prisma 6 or Prisma 7**. `PrismaAdapter` is database- and version-agnostic: it imports nothing from `@prisma/client` and only calls standard model-delegate methods (`findMany`, `findUnique`, `findFirst`, `create`, `createMany`, `update`, `updateMany`, `delete`, `deleteMany`, `upsert`, `count`) that behave identically across both majors. **You** construct the client and pass `prisma.<model>` as the `delegate` — Halifax never touches the parts that differ between the versions.

**Tenant-scoped paths require `updateMany` and `deleteMany` on the delegate.** When multi-tenant isolation is active, `updateOne` uses `updateMany(scopedWhere)` for an atomic ownership-enforced write, and `deleteOne` uses `deleteMany(scopedWhere)` for the same reason. If the delegate does not expose these methods, both operations throw `ServerError`. Standard Prisma delegates always expose them; this only affects non-standard or mock delegates.

> **Caveats.** Halifax's CI matrix exercises **Prisma 7 only** — Prisma 6 is supported on the strength of that stable delegate surface, not a dedicated CI leg, so treat it as best-effort and pin/test your own app against it. Prisma 7 is the recommended path.

What you implement differently on Prisma 6 (everything below is your project's Prisma setup — no Halifax code changes):

| Concern            | Prisma 7 (shown above)                                           | Prisma 6                                                                                   |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Datasource `url`   | Forbidden in `schema.prisma`; lives in `prisma.config.ts`        | `url = env("DATABASE_URL")` goes **back in the `datasource` block**                        |
| `prisma.config.ts` | Required (CLI reads the url from it)                             | Not used — the CLI reads the url from the schema                                           |
| Runtime client     | **Must** pass a driver adapter (`new PrismaClient({ adapter })`) | Plain `new PrismaClient()` works (built-in engine); driver adapters are opt-in (see below) |
| Driver adapters    | Default, no flag                                                 | Behind `previewFeatures = ["driverAdapters"]` in the `generator` block, if you want them   |

A minimal Prisma 6 setup (engine-based client, no adapter):

```prisma
// prisma/schema.prisma  (Prisma 6)
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
```

```ts
// src/db.ts  (Prisma 6 — no driver adapter needed)
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
```

From there, the `PrismaAdapter` usage (`new PrismaAdapter({ delegate: prisma.post })`) and everything else in this guide is identical.

## Supported Databases

The **same `PrismaAdapter`** works with every database Prisma supports — there is no adapter-per-database. All CRUD and the query builder compile to portable Prisma Client calls, so behaviour is identical across engines. To switch databases you change only the Prisma `provider` and driver adapter:

| Database        | Prisma `provider` | Driver adapter                   |
| --------------- | ----------------- | -------------------------------- |
| PostgreSQL      | `postgresql`      | `@prisma/adapter-pg`             |
| CockroachDB     | `cockroachdb`     | `@prisma/adapter-pg`             |
| MySQL / MariaDB | `mysql`           | `@prisma/adapter-mariadb`        |
| SQL Server      | `sqlserver`       | `@prisma/adapter-mssql`          |
| SQLite          | `sqlite`          | `@prisma/adapter-better-sqlite3` |

The integration suite runs unchanged against **all six** engines in CI — PostgreSQL, MySQL, MariaDB, SQL Server, CockroachDB, and SQLite, one matrix leg each (`HALIFAX_DB=<db>`) — so the "behaviour is identical across engines" claim is enforced, not asserted.

## Drizzle ORM Adapter

`DrizzleAdapter` implements the full `Repository` interface against any Drizzle-compatible database. It lives behind a sub-path export so `drizzle-orm` is never a hard dependency when unused:

```bash
pnpm add drizzle-orm
```

```ts
import { DrizzleAdapter } from '@edium/halifax/drizzle'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { usersTable } from './schema'

const db = drizzle(postgres(process.env.DATABASE_URL!))

const usersResource: ResourceDefinition = {
  routePrefix: 'users',
  repository: new DrizzleAdapter(db, usersTable)
  // No `fields` needed — derived automatically from the table schema.
}
```

### Supported databases

`DrizzleAdapter` (CRUD) and `DrizzleSqlExecutor` (stored procedures) have separate database
coverage — they share the same Drizzle connection but support different databases.

| Database        | CRUD (`DrizzleAdapter`)            | Execute (`DrizzleSqlExecutor`) | Drizzle driver import        |
| --------------- | ---------------------------------- | ------------------------------ | ---------------------------- |
| PostgreSQL      | ✅                                 | ✅ `SELECT fn()` + `CALL`      | `drizzle-orm/node-postgres`  |
| CockroachDB     | ✅ (postgres dialect)              | ⚠️ UDFs on CockroachDB ≥22.2   | `drizzle-orm/node-postgres`  |
| SQLite / LibSQL | ✅                                 | ❌ no stored routines          | `drizzle-orm/better-sqlite3` |
| MySQL           | ✅ `dialect: 'mysql'` (see note)   | ✅ `CALL` via text protocol    | `drizzle-orm/mysql2`         |
| MariaDB         | ✅ `dialect: 'mysql'` (see note)   | ✅ `CALL` via text protocol    | `drizzle-orm/mysql2`         |
| SQL Server      | ❌ no Drizzle driver               | ❌ no Drizzle driver           | —                            |

> **MySQL/MariaDB CRUD — two-round-trip writes.** MySQL and MariaDB lack a native `RETURNING`
> clause, so Drizzle's mysql2 builders omit `.returning()`. Pass `{ dialect: 'mysql' }` to
> `DrizzleAdapterConfig` and the adapter uses an INSERT→SELECT / UPDATE→SELECT path instead:
> two queries per write rather than one, but no atomicity loss for single-row operations.
>
> ```ts
> import { drizzle } from 'drizzle-orm/mysql2'
> import { DrizzleAdapter } from '@edium/halifax/drizzle'
>
> const db = drizzle(connection)
> const adapter = new DrizzleAdapter(db, usersTable, { dialect: 'mysql' })
> ```
>
> **Stored procedures on MySQL/MariaDB** via `DrizzleSqlExecutor` — Drizzle's `db.execute()`
> routes through mysql2's text protocol, not prepared statements. This avoids the error-1295
> limitation that blocks `PrismaSqlExecutor` on `@prisma/adapter-mariadb`.
>
> See [README_LIMITATIONS.md](./README_LIMITATIONS.md) for the full feature × database matrix.

### Type introspection

`DrizzleAdapter` calls `getTableColumns()` on your table and derives the Halifax field schema automatically — types, primary key, and `writable` flags are all inferred. For OpenAPI generation, Drizzle column types are mapped to their OpenAPI equivalents:

| Drizzle `dataType` | OpenAPI type | Format      |
| ------------------ | ------------ | ----------- |
| `string`           | `string`     | —           |
| `number`           | `number`     | —           |
| `boolean`          | `boolean`    | —           |
| `bigint`           | `integer`    | `int64`     |
| `date`             | `string`     | `date-time` |
| `json`             | `object`     | —           |
| `buffer`           | `string`     | `binary`    |

### Constructor options

```ts
new DrizzleAdapter(db, table, config?, scope?)
```

| Parameter        | Type                  | Description                                                                                                                                         |
| ---------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`             | Drizzle DB instance   | Any Drizzle-compatible database connection.                                                                                                         |
| `table`          | Drizzle `Table`       | Your table schema (e.g. `usersTable`).                                                                                                              |
| `config.idField` | `string` (optional)   | Primary key field name. Defaults to auto-detecting the first column marked `.primaryKey()`. Set explicitly for composite PKs or non-standard names. |
| `scope`          | `TenantScope \| null` | Tenant scope. Set by `withScope()` internally — do not pass directly.                                                                               |

### Relation includes

`DrizzleAdapter` does **not** support `?include=` (relation eager-loading). It reports
`capabilities.supportsIncludes: false`, so the router rejects `?include=` requests with
`422 Unprocessable Entity` rather than silently returning records with no related data.
If you need related records, fetch them with a second query or use `PrismaAdapter` for
the resource that requires includes.

### Multi-tenancy

`DrizzleAdapter` supports per-resource tenant scoping via `withScope()` exactly like `PrismaAdapter`. See [README_MULTITENANCY.md](./README_MULTITENANCY.md) for how to configure it on the resource.

### Static field derivation

You can derive the field schema without constructing a full adapter instance:

```ts
import { DrizzleAdapter } from '@edium/halifax/drizzle'
import { usersTable } from './schema'

const fields = DrizzleAdapter.fieldsFromTable(usersTable)
// Use as the `fields` array in a ResourceDefinition, or inspect for overrides.
```

## Targeting database Views

A database **view is just a model** to Halifax. Prisma exposes a `view` block as a delegate with the same read API as a model (`prisma.activeUsers.findMany()`), so you point a resource's repository at it and disable writes:

```ts
const activeUsersResource: ResourceDefinition = {
  name: 'ActiveUser',
  routePrefix: 'active-users',
  fields: [{ name: 'id' }, { name: 'email', filterable: true }],
  permissions: {
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

## Sequelize v6 Adapter

`SequelizeAdapter` implements the full `Repository` interface against any Sequelize v6 Model. It
lives behind a sub-path export so `sequelize` is never a hard dependency when unused:

```bash
pnpm add sequelize
# Plus the database driver your project needs:
pnpm add pg pg-hstore          # PostgreSQL
pnpm add mysql2                # MySQL or MariaDB
pnpm add tedious               # SQL Server
pnpm add sqlite3               # SQLite
```

```ts
import { Sequelize, DataTypes } from 'sequelize'
import { SequelizeAdapter } from '@edium/halifax/sequelize'
import type { SeqModel } from '@edium/halifax/sequelize'

const sequelize = new Sequelize(process.env.DATABASE_URL!, { dialect: 'postgres', logging: false })

const Post = sequelize.define('Post', {
  id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title:     { type: DataTypes.STRING,  allowNull: false, defaultValue: '' },
  content:   { type: DataTypes.TEXT,    allowNull: true },
  published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'posts', timestamps: false })

await sequelize.sync()

const postResource: ResourceDefinition = {
  routePrefix: 'posts',
  repository: new SequelizeAdapter(Post as unknown as SeqModel)
  // Fields are derived automatically from rawAttributes — no `fields` array needed.
}
```

### Supported databases

| Database    | CRUD | Query Builder | Relations (`?include=`) | Driver package |
| ----------- | ---- | ------------- | ----------------------- | -------------- |
| PostgreSQL  | ✅   | ✅            | ✅                      | `pg`           |
| MySQL       | ✅   | ✅            | ✅                      | `mysql2`       |
| MariaDB     | ✅   | ✅            | ✅                      | `mysql2`       |
| SQL Server  | ✅   | ✅            | ✅                      | `tedious`      |
| SQLite      | ✅   | ✅            | ✅                      | `sqlite3`      |
| CockroachDB | ❌ ⁽ᵃ⁾ | ❌          | ❌                      | —              |

> ⁽ᵃ⁾ CockroachDB is not in the tested matrix. Use `PrismaAdapter` for CockroachDB.

### Constructor options

```ts
new SequelizeAdapter(model, config?, scope?)
```

| Parameter        | Type                  | Description                                                                            |
| ---------------- | --------------------- | -------------------------------------------------------------------------------------- |
| `model`          | `SeqModel`            | Your Sequelize Model class (static side), cast via `as unknown as SeqModel`.           |
| `config.idField` | `string` (optional)   | Primary key field name. Defaults to auto-detecting the `primaryKey: true` attribute.   |
| `scope`          | `TenantScope \| null` | Tenant scope. Set by `withScope()` internally — do not pass directly.                  |

### Type introspection

`SequelizeAdapter` reads `model.rawAttributes` and maps each attribute's `type.key` to its
Halifax/OpenAPI equivalent:

| Sequelize type key             | OpenAPI type  | Format      |
| ------------------------------ | ------------- | ----------- |
| `STRING`, `TEXT`, `UUID`, …    | `string`      | —           |
| `INTEGER`, `BIGINT`, …         | `integer`     | —           |
| `FLOAT`, `DOUBLE`, `DECIMAL`   | `number`      | —           |
| `BOOLEAN`                      | `boolean`     | —           |
| `DATE`, `DATEONLY`             | `string`      | `date-time` |
| `JSON`, `JSONB`                | `object`      | —           |

### Relations / `?include=`

`SequelizeAdapter` reports `capabilities.supportsIncludes: true`. To use eager loading,
pass Sequelize association include option objects (cast to `string[]`) in `ListOptions.include`.
The associations must be set up before the adapter is used:

```ts
Author.hasMany(Post, { foreignKey: 'authorId', as: 'posts' })
Post.belongsTo(Author, { foreignKey: 'authorId', as: 'author' })

// In a request handler:
const result = await repo.getMany({
  include: [{ model: Author, as: 'author' }] as unknown as string[]
})
```

### `createMany` and returned records

`SequelizeAdapter.createMany` delegates to Sequelize's `bulkCreate`, which returns the created
instances on all supported dialects. `capabilities.supportsCreateManyReturn` is always `true` —
passing an empty array returns `[]` immediately without a database round-trip.

### Conflict errors (409)

`createOne`, `createMany`, and `updateOne` catch `SequelizeUniqueConstraintError` (unique-index
violations) and re-throw them as Halifax's `ConflictError` (HTTP 409). This means the client
receives a consistent `409` shape rather than an opaque `500` — identical to how `PrismaAdapter`
and `DrizzleAdapter` handle the same constraint.

### `upsertOne` — non-atomic check-then-write

`upsertOne` does a `getOne` check followed by either `updateOne` or `createOne`. This is
non-atomic: under concurrent load, two simultaneous upserts for the same absent ID may both reach
the `createOne` branch and receive a `ConflictError` (409). For true atomicity, implement a custom
repository that calls Sequelize's `upsert()` method directly.

### `updateOne` dialect differences

On PostgreSQL and SQL Server, `updateOne` uses a single `UPDATE … RETURNING` query. On MySQL,
MariaDB, and SQLite (which lack `RETURNING`), it runs `UPDATE` then `SELECT` — two queries per
update. Both paths produce the same result; the two-query path has a narrow TOCTOU window on
concurrent deletes, which is an acceptable trade-off for cross-dialect portability.

### Static field derivation

```ts
import { SequelizeAdapter } from '@edium/halifax/sequelize'
import type { SeqModel } from '@edium/halifax/sequelize'

const fields = SequelizeAdapter.fieldsFromModel(MyModel as unknown as SeqModel)
```

### Stored-procedure endpoints — `SequelizeSqlExecutor`

`SequelizeSqlExecutor` gives Sequelize parity with `PrismaSqlExecutor` and `DrizzleSqlExecutor`.
It takes the Sequelize **instance** (not a Model) and auto-detects the dialect:

```ts
import { SequelizeSqlExecutor } from '@edium/halifax/sequelize'

const executor = new SequelizeSqlExecutor(sequelize) // dialect auto-detected

const api = registerCrudApi(server, resources, {
  execute: {
    executor,
    procedures: [
      {
        name: 'send_invoice',
        params: [
          { name: 'orderId', type: 'number', required: true },
          { name: 'email',   type: 'string', required: true }
        ]
      }
    ]
  }
})
```

| Dialect                | Call style                      | Param binding              |
| ---------------------- | ------------------------------- | -------------------------- |
| PostgreSQL             | `SELECT * FROM "fn"($1, …)` → `CALL "fn"($1, …)` on 42809 | `bind` (real prepared stmts) |
| MySQL / MariaDB        | `CALL \`fn\`(?, …)`             | `replacements` (text protocol — no ER_UNSUPPORTED_PS) |
| SQL Server             | `EXEC [fn] ?, …`                | `replacements`             |

The dialect is auto-detected from `sequelize.getDialect()`. Pass `{ dialect: 'postgres' | 'mysql' | 'mssql' }` to override. SQLite throws `NotImplementedError` — it has no stored routines.

### GraphQL

`SequelizeAdapter` is fully GraphQL-compatible. The GraphQL type system is driven by
`resource.fields`, which is derived automatically from `model.rawAttributes` — the same field
schema used by REST. No extra configuration is required:

```ts
registerCrudApi(server, resources, {
  graphql: { enabled: true }
})
// SequelizeAdapter-backed resources appear in the GraphQL schema identically to
// PrismaAdapter or DrizzleAdapter resources.
```

All query, mutation, filter, sort, and field-level permission features work identically over GraphQL and REST for Sequelize-backed resources.

### Multi-tenancy

`SequelizeAdapter` supports per-resource tenant scoping via `withScope()` exactly like
`PrismaAdapter`. See [README_MULTITENANCY.md](./README_MULTITENANCY.md) for how to configure it
on the resource.
