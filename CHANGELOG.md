# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/splayfee/halifax/releases/tag/v1.0.0
