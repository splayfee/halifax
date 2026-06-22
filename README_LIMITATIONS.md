# Halifax — Adapter & Database Compatibility

This document is the authoritative compatibility reference for Halifax's three built-in ORM
adapters (`PrismaAdapter`, `DrizzleAdapter`, `SequelizeAdapter`) across all six supported
databases. Read it before choosing an adapter for a new project or before reporting unexpected
behaviour.

---

## Feature × Database × Adapter Matrix

### Cross-cutting features (work with every supported combination)

These are HTTP-layer or middleware concerns — they are not affected by which adapter or database
you choose:

- **OpenAPI 3.1 spec** — auto-generated from resource/field/parameter declarations
- **Redis / in-memory caching** — read-through, write-invalidating, tenant-safe
- **Auth & role gating** — API key, JWT/Bearer, Passport strategies, per-action roles
- **Lifecycle hooks** — `beforeCreate`, `afterCreate`, `beforeQuery`, …
- **Multi-tenant scoping** — `withScope()` enforced on all reads and writes
- **Custom endpoints** — `api.addCustomEndpoint(...)` with inherited auth and OpenAPI
- **Response enveloping** — `envelope: 'data'` wraps every success body
- **Read-only resource mode** — disable all write permissions via `permissions: { allowCreate: false, … }`

---

### Prisma Adapter (`PrismaAdapter` / `PrismaSqlExecutor`)

Prisma compiles all queries to portable Prisma Client calls (no raw SQL), so nearly every feature
runs on every supported provider without any per-database code path.

| Database        | CRUD REST | Query Builder | Relations (`?include=`) | Execute Endpoint          | GraphQL |
| --------------- | --------- | ------------- | ----------------------- | ------------------------- | ------- |
| **PostgreSQL**  | ✅        | ✅            | ✅                      | ✅ `SELECT fn()` + `CALL` | ✅      |
| **MySQL**       | ✅        | ✅            | ✅                      | ✅ `CALL` — see note ¹    | ✅      |
| **MariaDB**     | ✅        | ✅            | ✅                      | ✅ `CALL` — see note ¹    | ✅      |
| **SQL Server**  | ✅        | ✅            | ✅                      | ✅ `EXEC`                 | ✅      |
| **CockroachDB** | ✅        | ✅            | ✅                      | ⚠️ see note ²             | ✅      |
| **SQLite**      | ✅        | ✅            | ✅                      | ❌ no stored routines     | ✅      |

---

### Drizzle Adapter (`DrizzleAdapter` / `DrizzleSqlExecutor`)

`DrizzleAdapter` (CRUD) and `DrizzleSqlExecutor` (stored procedures) have separate database
coverage — they share the same Drizzle connection but support different databases.

| Database        | CRUD REST | Query Builder | Relations (`?include=`) | Execute Endpoint              | GraphQL  |
| --------------- | --------- | ------------- | ----------------------- | ----------------------------- | -------- |
| **PostgreSQL**  | ✅        | ✅            | ❌ ³                    | ✅ `SELECT fn()` + `CALL`     | ✅       |
| **MySQL**       | ✅ ⁴      | ✅            | ❌                      | ✅ `CALL` via text protocol ⁵ | ✅       |
| **MariaDB**     | ✅ ⁴      | ✅            | ❌                      | ✅ `CALL` via text protocol ⁵ | ✅       |
| **SQL Server**  | ❌ no driver | ❌          | ❌                      | ❌ no driver                  | ❌       |
| **CockroachDB** | ✅        | ✅            | ❌                      | ⚠️ use `dialect: 'postgres'`  | ✅       |
| **SQLite**      | ✅        | ✅            | ❌                      | ❌ no stored routines         | ✅       |

---

### Sequelize Adapter (`SequelizeAdapter` / `SequelizeSqlExecutor`)

Sequelize v6 supports five SQL databases out of the box and uses Op symbol-based query translation
that mirrors the Prisma and Drizzle adapters' ComparisonStrategy contract.

| Database        | CRUD REST | Query Builder | Relations (`?include=`) | Execute Endpoint              | GraphQL |
| --------------- | --------- | ------------- | ----------------------- | ----------------------------- | ------- |
| **PostgreSQL**  | ✅        | ✅            | ✅ ⁶                    | ✅ `SELECT fn()` + `CALL` ⁷   | ✅      |
| **MySQL**       | ✅        | ✅            | ✅                      | ✅ `CALL` via replacements ⁷  | ✅      |
| **MariaDB**     | ✅        | ✅            | ✅                      | ✅ `CALL` via replacements ⁷  | ✅      |
| **SQL Server**  | ✅        | ✅            | ✅                      | ✅ `EXEC` via replacements ⁷  | ✅      |
| **CockroachDB** | ❌ ⁸      | ❌            | ❌                      | ❌                            | ❌      |
| **SQLite**      | ✅        | ✅            | ✅                      | ❌ no stored routines         | ✅      |

---

## Notes and Explanations

### ¹ Prisma execute — MySQL/MariaDB: native connector only

`PrismaSqlExecutor` issues `CALL name(?, …)` for MySQL and MariaDB. This works correctly with the
**native Prisma connector** (`new PrismaClient()` on Prisma 6, or a direct connection on Prisma 7).

With `@prisma/adapter-mariadb` (the only runtime option for MySQL/MariaDB on Prisma 7), **all raw
queries are routed through the MySQL prepared-statement protocol**. The prepared-statement protocol
rejects `CALL` with error 1295 (`ER_UNSUPPORTED_PS`). This is a Prisma driver-adapter limitation,
not a MySQL limitation — the `CALL` statement itself is valid MySQL SQL.

**Workaround:** use `DrizzleSqlExecutor` or `SequelizeSqlExecutor` instead of `PrismaSqlExecutor`
for MySQL/MariaDB stored procedures. Both route through the text protocol which happily runs `CALL`.
See notes ⁵ and ⁷.

### ² Prisma execute — CockroachDB: version-dependent

CockroachDB is detected as `postgres` dialect, so `PrismaSqlExecutor` issues `SELECT * FROM fn(…)`.
UDFs (user-defined functions) were added in CockroachDB 22.2; `CALL` procedures are available from
23.1. If your CockroachDB version predates these, the execute endpoint will fail at the database
level with an unrecognized syntax error.

### ³ DrizzleAdapter — relations / `?include=` not supported

`DrizzleAdapter` reports `capabilities.supportsIncludes: false`. When a request carries `?include=`,
the router returns `422 Unprocessable Entity` rather than silently returning records without the
related data.

**Why:** Drizzle's join API is compile-time typed — you chain `.innerJoin(otherTable, condition)`
with concrete table schema objects that must be known at compile time. Halifax cannot generate those
joins generically at runtime without knowing every possible related table's schema at startup. This
is a fundamental architectural constraint of Drizzle's type-safe design.

**Workaround:** use `PrismaAdapter` or `SequelizeAdapter` for any resource that needs `?include=`
relation loading.

### ⁴ DrizzleAdapter — MySQL/MariaDB CRUD: two-round-trip writes

MySQL and MariaDB do not support a native `RETURNING` clause. When `dialect: 'mysql'` is passed to
`DrizzleAdapterConfig`, Halifax uses a two-query write path instead:

- **INSERT**: insert row, read `insertId` from result, SELECT the inserted row
- **UPDATE**: UPDATE rows, then SELECT by id/scope
- **DELETE**: read `affectedRows` from result — no extra SELECT needed

This is two queries per write instead of one. The trade-off is worth it to support MySQL natively.

### ⁵ DrizzleSqlExecutor — MySQL/MariaDB: text protocol advantage

`DrizzleSqlExecutor` on MySQL/MariaDB routes stored procedure calls through Drizzle's `db.execute()`,
which internally calls mysql2's `client.query()` (the **text protocol**, not the prepared-statement
protocol). This means `CREATE PROCEDURE` DDL and `CALL` statements all work — the error-1295
limitation that blocks `@prisma/adapter-mariadb` does not apply here.

### ⁶ SequelizeAdapter — relations / `?include=`

`SequelizeAdapter` reports `capabilities.supportsIncludes: true`. To use eager loading, pass
Sequelize `include` option objects (with `model`, `as`, `required`, etc.) cast to `string[]` in
`ListOptions.include`. The actual Sequelize association setup (`.belongsTo`, `.hasMany`, etc.)
must be done before passing the model to the adapter.

### ⁷ SequelizeSqlExecutor — stored procedures on all four dialects

`SequelizeSqlExecutor` wraps a raw Sequelize instance (`sequelize`, not a Model) and supports:

- **Postgres** — `SELECT * FROM "fn"($1, …)` using `bind` parameters (real prepared statements);
  falls back to `CALL "fn"($1, …)` on SQLSTATE 42809 when the routine is a PROCEDURE, caching the
  classification per name.
- **MySQL / MariaDB** — `CALL \`fn\`(?, …)` using `replacements` (Sequelize text protocol). This
  avoids the prepared-statement `ER_UNSUPPORTED_PS` error-1295 that blocks `PrismaSqlExecutor`
  with the Prisma 7 driver adapter.
- **SQL Server** — `EXEC [fn] ?, …` using `replacements`.

```ts
import { SequelizeSqlExecutor } from '@edium/halifax/sequelize'

// dialect is auto-detected from sequelize.getDialect()
const executor = new SequelizeSqlExecutor(sequelize)

registerCrudApi(server, resources, {
  execute: {
    executor,
    procedures: [
      { name: 'get_report', params: [{ name: 'month', type: 'number', required: true }] }
    ]
  }
})
```

### ⁸ SequelizeAdapter — CockroachDB out of scope

Sequelize uses the `postgres` dialect for CockroachDB, but CockroachDB-specific quirks (serial
column semantics, dialect-level DDL differences) can cause `sync()` and type-mapping issues.
Halifax's Sequelize integration is validated against the five explicitly listed databases only.
Use `PrismaAdapter` for CockroachDB (Prisma handles the dialect transparently).

---

## Choosing an adapter

| Situation                                | Recommended adapter                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| PostgreSQL, CockroachDB                  | Any — all three work equally well (PrismaAdapter or DrizzleAdapter for GraphQL)                       |
| MySQL or MariaDB CRUD                    | **Prisma**, **Drizzle** (`dialect: 'mysql'`), or **Sequelize** — all supported                       |
| MySQL or MariaDB stored procedures       | **Drizzle** (`DrizzleSqlExecutor`) or **Sequelize** (`SequelizeSqlExecutor`) — both use text protocol; avoid `PrismaSqlExecutor` with Prisma 7 driver adapter |
| SQL Server                               | **Prisma** or **Sequelize** — Drizzle has no MSSQL driver                                            |
| SQLite (edge / embedded)                 | Any — all three tested                                                                                |
| Relation eager loading (`?include=`)     | **Prisma** or **Sequelize** — `DrizzleAdapter` explicitly does not support includes                   |
| Stored-procedure endpoints               | **Prisma** (`PrismaSqlExecutor`), **Drizzle** (`DrizzleSqlExecutor`), or **Sequelize** (`SequelizeSqlExecutor`) — all three ship an executor |
| Maximum GraphQL coverage                 | Any — all three adapters support GraphQL on their respective databases                                |
| `createMany` returns records             | Any — all three return records from `createMany`                                                      |
| Existing Sequelize schema / models       | **Sequelize** — drop-in; pass your existing Sequelize model class directly                            |
| Schema migrations via code               | **Sequelize** (`sequelize.sync`) or **Prisma** (`prisma migrate`) — Drizzle requires its own tooling  |
