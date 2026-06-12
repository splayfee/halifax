# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0]

### Added

- **Configurable response envelope.** A new `envelope` option wraps every success response body
  under a single key (e.g. `envelope: 'data'` → `{ "data": <body> }`). Set it API-wide on
  `createExpressCrudRouter`/`registerCrudApi` options, or per resource on `ResourceDefinition`
  (the per-resource setting wins, including an explicit `null`/`''` to opt a single resource out
  of an API-wide envelope). The wrap is uniform across list, single, create/update/upsert, and
  the delete confirmation; **error responses are never enveloped**, keeping one stable error
  contract. Applied at the response boundary (after the cache), so cached payloads are
  envelope-agnostic. Eases adopting Halifax behind clients that expect a legacy `{ data: ... }`
  shape. Defaults to off — fully backward compatible.

## [2.0.0]

A breaking release with two themes: **permissive, minimal-by-default resource definitions**
(declare the exceptions, not the boilerplate), and a **full real-database CI matrix** that
verifies every supported engine for real.

### Added

- **Full real-database CI matrix** — the integration suite now runs against **six** engines,
  each in its own container: PostgreSQL, MySQL, MariaDB, SQL Server, CockroachDB, and SQLite
  (embedded). Previously only PostgreSQL, MySQL, and SQLite ran in CI.
- `docker-compose.test.yml` (one service per engine) and `scripts/integration-matrix.sh` /
  `pnpm test:integration:all` to bring the databases up and run the suite against each — the
  same path CI uses, so local and CI runs are identical.
- Prisma schemas for SQL Server (`schema.mssql.prisma`) and CockroachDB
  (`schema.cockroachdb.prisma`, using `sequence()` ids to stay 32-bit-safe), and the
  `@prisma/adapter-mssql` driver adapter.
- An ID-kind-aware integration suite: assertions adapt to the engine's key type (integer vs
  MongoDB `ObjectId`), so one suite runs honestly across every engine.

### Changed (breaking)

- **`ResourceDefinition` is permissive and minimal.** Only `routePrefix`, `repository`, and
  `fields` are required — and `fields` only when the repository exposes no schema of its own.
  - `name` is now **optional** — it defaults to a title-cased form of `routePrefix`
    (`'blog-posts'` → `'Blog Posts'`) and can still be overridden.
  - **`fields` is now optional and override-aware.** When the repository exposes a field schema
    (any `PrismaAdapter` built with a `model`, and everything from `createPrismaResources`), that
    schema is the base and the resource's `fields` are merged over it **by name** as sparse
    overrides — so you list a field only to _change_ it. With a bare adapter, `fields` remains
    the authoritative allow-list.
- **Field flags are permissive by default.** `filterable`, `sortable`, `selectable`, and now
  **`writable`** all default to `true`. Previously `writable` defaulted to `false` — bodies now
  accept any defined field unless you set `writable: false`. The **primary key is protected**: it
  is non-writable by default (set `writable: true` to opt in).
- **Page size is bounded by generous defaults — at most 5000 records per request.**
  `defaultLimit: 5000` and `maxLimit: 5000` (exported as `DEFAULT_PAGE_LIMIT` / `MAX_PAGE_LIMIT`)
  apply when a resource sets none — large enough for typical "show everything" UIs, a seatbelt
  against an accidental unbounded scan of a large table. Previously an unset limit returned every
  row, uncapped. The response `count` is always the true total, so a capped page is never a silent
  drop. Set `defaultLimit: 0` to skip the default bound (return all rows when `?limit=` is omitted)
  and `maxLimit: 0` to remove the cap — use both to disable pagination entirely.
- **`RepositoryCapabilities` trimmed to the two flags that carry their weight:** removed
  `supportsTransactions` (no transaction feature existed) and `supportsQueryAst` (always true;
  implied by the presence of `executeQuery`). `supportsIncludes` now has teeth — the router
  rejects `?include=` with `422` when a repository reports `supportsIncludes: false`. The
  `Repository` interface gained optional `fields` / `relations` / `idField` for schema exposure.
- **Widened the `@prisma/client` peer dependency to `>=6.0.0`** (was `>=7.0.0`). `PrismaAdapter`
  imports nothing from `@prisma/client` and only calls stable model-delegate methods, so it runs
  unchanged on Prisma 6 or 7. CI exercises Prisma 7 only, so Prisma 6 is best-effort; its main
  draw is MongoDB, which Prisma 7 does not yet support. See README_REPO_ADAPTERS.md for the
  schema/client differences a Prisma 6 project needs.

### Removed

- **MongoDB** from the advertised supported-database list and the CI matrix. Prisma ORM v7
  dropped MongoDB support ("coming soon in v7"), and the matrix targets Prisma 7. MongoDB still
  works on **Prisma 6** (now also supported — see above). The forward-ready `schema.mongodb.prisma`
  and an `ObjectId`-aware integration suite remain in the repo so MongoDB rejoins the matrix
  unchanged once Prisma 7 restores support.
- The "PostgreSQL, MySQL, and SQLite run in CI; the rest use the same adapter and test harness"
  documentation caveat — every advertised relational engine is now verified in CI against a real
  database.
- The deprecated auth aliases `AuthProvider`, `AllowAllAuthProvider`, `ApiKeyAuthProvider`, and
  `PermissionAuthProvider`. Use `AuthStrategy`, `AllowAllAuthStrategy`, `ApiKeyAuthStrategy`, and
  `JwtClaimsAuthStrategy` respectively.

### Migration

- Resource definitions can be slimmed dramatically: drop `name` (unless you want a specific one),
  drop per-field `filterable`/`sortable`/`selectable`/`writable: true` flags, and drop
  `defaultLimit`/`maxLimit` if 5000/5000 suit you.
- **If your app relied on list endpoints returning _every_ row** (no limit), set
  `defaultLimit: 0` and `maxLimit: 0` on those resources (or globally via
  `createPrismaResources({ defaultLimit: 0, maxLimit: 0 })`) — otherwise results are now bounded
  at 5000 by default.
- If you relied on `writable` defaulting to `false`, audit your `fields`: any field that should
  not be client-writable now needs an explicit `writable: false` (the primary key is already
  protected automatically).
- If you read `capabilities.supportsTransactions` or `capabilities.supportsQueryAst`, remove those
  references (use `typeof repo.executeQuery === 'function'` to detect query-AST support).

## [1.0.0]

First public release.

### Added

- **Auto-CRUD engine** — generate standards-compliant REST endpoints (list, read, create,
  update, upsert, delete, and bulk update/delete) from a single `ResourceDefinition`, with
  correct status codes, a consistent `{ errors: [...] }` body, content negotiation (406/415),
  method-not-allowed (405 + `Allow`), and `X-Correlation-ID` / `Idempotency-Key` support.
- **HTTP adapters** — Express 4/5, Fastify, HyperExpress, and Ultimate Express, each published
  as its own subpath entry point and verified against one shared conformance suite.
- **Prisma repository adapter** — one `PrismaAdapter` for every Prisma provider (PostgreSQL,
  MySQL/MariaDB, SQL Server, SQLite, CockroachDB, MongoDB).
- **Dynamic query-builder endpoint** (`POST /:resource/query`) — a validated query AST
  (filter/sort/paginate/project, `AND`/`OR`/nesting, `IN`, `BETWEEN`, `CONTAINS`,
  `STARTS WITH`, `ENDS WITH`, …) compiled to portable Prisma Client calls — no raw SQL, so
  the same request behaves identically on every database.
- **Multi-tenancy** — per-resource tenant scoping with fail-closed guarantees.
- **Read-through caching** — pluggable `CacheStore` (in-memory default, `RedisCacheStore`
  provided), per-resource TTLs, never-expire mode, automatic write-invalidation, tenant-safe
  keys, and a `Cache-Control` cache-bust header.
- **Auth & field-level security** — API key, JWT/Bearer, and Passport strategies; per-action
  required permissions; and `filterable`/`sortable`/`selectable`/`writable` field flags.

[2.0.0]: https://github.com/splayfee/halifax/releases/tag/v2.0.0
[1.0.0]: https://github.com/splayfee/halifax/releases/tag/v1.0.0
