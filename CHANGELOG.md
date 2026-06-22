# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0]

`@edium/halifax`, `@edium/halifax-types`, and `@edium/halifax-client` are all released together at `3.0.0`.

### Changed — BREAKING

- **Secure-by-default permissions.** `defaultCrudPermissions` now disables the **bulk / whole-collection
  writes** that a single bad filter could use to mutate or destroy an entire (tenant's) table:
  `allowUpdateMany` (`PATCH /{resource}`) and `allowDeleteMany` (`DELETE /{resource}`) now default to
  **`false`**. Every single-record verb remains on by default — `create`, `readOne`, `readMany`, the
  query-builder `POST /{resource}/query`, `updateOne`, `deleteOne`, and `upsertOne`
  (`PUT /{resource}/:id`, which only ever touches one row).

  **Migration:** any resource that needs a bulk verb must opt in explicitly:

  ```ts
  { routePrefix: 'widgets', repository, fields,
    permissions: { allowUpdateMany: true, allowDeleteMany: true } }
  ```

### Added

- **`SequelizeAdapter`** (`@edium/halifax/sequelize`) — full `Repository` implementation for
  Sequelize v6 covering PostgreSQL, MySQL, MariaDB, SQL Server, and SQLite. Field schema is
  derived automatically from `model.rawAttributes`; `updateOne` uses a single `RETURNING` query on
  PostgreSQL + MSSQL and a two-round-trip UPDATE→SELECT on MySQL/MariaDB/SQLite; `withScope()`
  stamps and filters the tenant column on every read and write; `capabilities.supportsIncludes: true`
  lets Sequelize associations flow through `?include=`; **fully GraphQL-compatible** — no extra
  configuration needed beyond `graphql: { enabled: true }`. Install: `pnpm add sequelize` plus
  the dialect's native driver (`pg`, `mysql2`, `tedious`, or `sqlite3`).
  See [README_REPO_ADAPTERS.md](./README_REPO_ADAPTERS.md#sequelize-v6-adapter).

- **`SequelizeSqlExecutor`** (`@edium/halifax/sequelize`) — stored-procedure executor for
  Sequelize, giving it full parity with `PrismaSqlExecutor` and `DrizzleSqlExecutor`. Dialect is
  auto-detected from `sequelize.getDialect()`; pass `{ dialect }` to override. Supported dialects:
  - **PostgreSQL** — `SELECT * FROM "fn"($1, …)` with `bind` params; automatic `CALL` fallback on
    SQLSTATE 42809 (cached per routine name).
  - **MySQL / MariaDB** — `CALL \`fn\`(?, …)` via Sequelize `replacements` (text protocol). This
    avoids the `ER_UNSUPPORTED_PS` error-1295 limitation that blocks `PrismaSqlExecutor` with
    `@prisma/adapter-mariadb`.
  - **SQL Server** — `EXEC [fn] ?, …` via `replacements`.
  See [README_REPO_ADAPTERS.md](./README_REPO_ADAPTERS.md#stored-procedure-endpoints--sequelizesqlexecutor)
  and [README_EXECUTE.md](./README_EXECUTE.md).

- **`DrizzleAdapter` MySQL/MariaDB CRUD** — new `dialect: 'mysql'` option in `DrizzleAdapterConfig`
  enables full CRUD for MySQL and MariaDB. With `dialect: 'mysql'`, writes use a two-round-trip
  path (INSERT → `insertId` → SELECT; UPDATE → SELECT; DELETE → `affectedRows`) since MySQL lacks
  a native `RETURNING` clause. Fully tested against real MySQL and MariaDB via the integration
  matrix. Pass `{ dialect: 'mysql' }` when constructing a `DrizzleAdapter` with a `drizzle-orm/mysql2`
  connection.

- **Validator-agnostic request validation for custom endpoints.** `addCustomEndpoint`'s options bag
  accepts `validate: { body?, query?, params? }`, each an `ISchemaValidator`. The request part is
  validated and coerced before the handler runs; a failure short-circuits with `422` and a
  `details.fieldErrors` list. When a schema can emit a JSON Schema, the endpoint's OpenAPI
  `requestBody`/`parameters` are **auto-generated** from it (explicit `openapi` metadata still wins).
  See [README_VALIDATION.md](./README_VALIDATION.md).

- **`ISchemaValidator` interface + official adapters.** The validator-agnostic contract
  (`ISchemaValidator`, `ValidationResult`, `FieldError`, `JsonSchema`) lives in `@edium/halifax-types`
  and is shared by the server and `@edium/halifax-client`. Adapters ship as opt-in subpaths for
  **Yup, Zod, Joi, and Valibot** — `@edium/halifax-types/{yup,zod,joi,valibot}` (re-exported for
  convenience as `@edium/halifax/{yup,zod,joi,valibot}`). Each validator is an optional peer
  dependency, so importing one never pulls in the others. **All four adapters emit a JSON Schema for
  auto-OpenAPI** out of the box — Zod via native `z.toJSONSchema`, Yup and Joi via `schema.describe()`,
  Valibot via schema-structure traversal — so existing schemas document themselves with zero rewrites.

- **Stored-procedure endpoints (`execute`, off by default).** Like GraphQL, configured via
  `execute: { executor, procedures }`. **Each registered procedure becomes its own auto-documented
  `POST` route** — at `${basePath}/<kebab-name>` by default (e.g. `get_report` → `/execute/get-report`),
  or a `path` you supply. Parameters are declared (`{ name, type, required }`), the JSON request body
  is keyed by those names, validated (`422` on missing/unknown/wrong-typed), then bound positionally.
  Each procedure takes its own `roles`; an unregistered name simply has no route (clean `404`). Ships
  `PrismaSqlExecutor` (PostgreSQL, MySQL/MariaDB, SQL Server), `DrizzleSqlExecutor` (PostgreSQL,
  MySQL/MariaDB via text protocol), and `SequelizeSqlExecutor` (PostgreSQL, MySQL/MariaDB, SQL Server
  — same text-protocol advantage for CALL; no ER_UNSUPPORTED_PS). SQLite has no stored routines.
  See [README_EXECUTE.md](./README_EXECUTE.md).

## [2.7.0]

### Added

- **Public (unauthenticated) custom endpoints** — `addCustomEndpoint` can now register a route
  that skips authentication entirely, for health checks, login/activation, password reset, and
  inbound webhooks. Pass `null` as the `roles` argument (`addCustomEndpoint('POST', '/login', null, handler)`)
  or `{ auth: false }` in the options bag. The handler receives an unauthenticated context
  (`ctx.auth === { isAuthenticated: false }`) and owns any further checks. Public operations are
  marked `security: []` in the live OpenAPI spec so Swagger UI renders no lock for them.

- **Per-endpoint content negotiation (`consumes` / `produces`)** — custom endpoints are no longer
  restricted to `application/json`. The options bag accepts `consumes` (request `Content-Type`s the
  route accepts — e.g. `['multipart/form-data']` for file uploads) and `produces` (response types
  negotiated against `Accept` — e.g. `['application/pdf']` for streamed downloads). Both default to
  `['application/json']`, so existing endpoints keep the same 415/406 behaviour. A `*/*` entry in
  `consumes` accepts any body; a media-type family wildcard in `Accept` (e.g. `application/*`) is honoured.

- **`AuthStrategy.authorizeCustom(params)`** — an optional strategy method, the custom-endpoint
  counterpart of `authorize`. When implemented it is called (instead of the flat role OR-match) for
  every custom endpoint that does not declare its own `authorize` predicate, so a strategy can apply
  the **same** hierarchical / privilege-threshold authorization to custom routes that it already
  applies to auto-CRUD. Receives `{ auth, method, path, requiredPermissions, req }`. Strategies that
  do not implement it fall back to the existing OR-match — fully backward compatible.

- **Per-endpoint `authorize` predicate** — the options bag accepts an `authorize(ctx)` callback
  (`{ auth, req }`) for one-off, resource-specific authorization (e.g. ownership checks). When
  present it is the **sole** authorization gate, overriding both `roles` matching and
  `authorizeCustom`. Set `useStrategyAuthorize: false` to force the flat OR-match instead.

- **`CompositeAuthStrategy`** — a new strategy that combines several strategies and adopts the first
  one that authenticates a request, so a single route can be reached by more than one credential
  (e.g. an interactive **session** _or_ a programmatic **API key** whose scopes map to
  `auth.permissions`). Authorization (`authorize` / `authorizeCustom`) and the OpenAPI security
  scheme are delegated to whichever member strategy actually authenticated the request.

- **Options-bag overload for `addCustomEndpoint`** — alongside the positional
  `(method, path, roles, handler, openapi?)` form, `addCustomEndpoint(method, path, options, handler)`
  accepts a `CustomEndpointOptions` object exposing `roles`, `auth`, `authorize`,
  `useStrategyAuthorize`, `consumes`, `produces`, and `openapi`.

### Changed

- **`crudRouter.ts` decomposed into single-responsibility modules under `src/core/router/`** —
  `trackingHttpServer.ts` (route tracking), `halifaxApi.ts` (the `HalifaxApi` class), `options.ts`
  (`CrudApiOptions`/`TenantOptions`), `resolveResource.ts` (field/name normalization), `tenantScope.ts`
  (tenant-field resolution + the cached, scoped `resolveRepo`), `resourceRoutes.ts` (per-resource
  preparation + CRUD/405 registration), `graphqlRoutes.ts`, and `openApiRoutes.ts`. `crudRouter.ts`
  is now a thin orchestrator (`registerCrudApi`) that re-exports the same public surface, so every
  `@/core/crudRouter.js` import path is unchanged.
- **Custom-endpoint logic extracted to `src/core/customEndpoint.ts`** — the registration, options
  normalization, and authorization pipeline live in a focused module (re-exported from
  `crudRouter.ts`). No behavioural change for the existing positional `addCustomEndpoint` call.
- **GraphQL `resourceResolvers.ts` decomposed into `src/graphql/resolvers/`** — `resourceTypes.ts`
  (per-resource GraphQL type construction + the shared `ResolverContext`), `queryResolvers.ts`
  (`get`/`list`/`query`), and `mutationResolvers.ts` (create/update/upsert/delete + bulk variants).
  `resourceResolvers.ts` is now a thin `addResourceFields` orchestrator; the generated schema is
  byte-for-byte identical.
- **Query AST comparison logic unified via a Strategy table** — the duplicated 17-case `switch` in
  `astToPrisma.ts` and `astToDrizzle.ts` is replaced by per-adapter `ComparisonStrategyTable`s
  dispatched through one shared `buildComparison` in `src/adapters/orm/ComparisonStrategy.ts` (GoF
  Strategy). Operator normalization + fallback now live in exactly one place, keeping the Prisma and
  Drizzle compilers behaviourally in lockstep; a total `Record` makes the compiler enforce that every
  adapter maps all operators.
- **`PrismaAdapter` split** — the intricate tenant-safe single-row write paths moved to
  `prismaScopedWrites.ts` (`scopedUpdateOne`/`scopedUpsertOne`/`scopedDeleteOne`) and the
  model-introspection helpers to `prismaSchema.ts`. `PrismaAdapter.ts` drops from 493 → 367 lines and
  its worst cyclomatic hotspot (`upsertOne`, ~CC 20) is now small named functions. `PrismaAdapter.fieldsFromModel`/`relationsFromModel` remain as static members for compatibility.
- **`filterWritableFields` is now generic** (`<T>(…) => Partial<T>`), removing all nine `as never`
  casts at the repository write boundary in the handlers and GraphQL mutation resolvers.
- **Design-pattern-explicit file names** — the read-through caching repository (GoF **Decorator**)
  moved to `CachingRepositoryDecorator.ts`, and the comparison Strategy table to `ComparisonStrategy.ts`,
  so each file advertises the pattern it implements (joining the existing `*Adapter`/`*Strategy`
  conventions). Public export names (`createCachingRepository`, `buildComparison`) are unchanged.

### Tests

- **`tests/integration/customEndpointFeatures.integration.test.ts`** — a new end-to-end suite over a
  real Express server (supertest) covering the 2.7 features: public endpoints, `consumes`/`produces`
  content negotiation (incl. 415/406), `authorizeCustom` role hierarchy, the per-endpoint `authorize`
  predicate, and `CompositeAuthStrategy`. Runs without a database. New unit suites cover the same
  paths plus `CompositeAuthStrategy` in isolation.

### Notes

- **Backward compatible.** The positional `addCustomEndpoint(method, path, roles, handler, openapi?)`
  call, default JSON-only content negotiation, always-authenticate-when-`roles`-is-an-array, and the
  flat OR-match (when a strategy has no `authorizeCustom`) all behave exactly as in 2.6.0. The router
  and resolver decomposition is internal only — the public API surface is unchanged.

## [2.6.0]

### Added

- **`HalifaxApi` class and `addCustomEndpoint`** — `registerCrudApi()` now returns a `HalifaxApi`
  instance instead of `void`. Existing code that ignores the return value is unaffected.
  The instance exposes `addCustomEndpoint(method, path, roles, handler, openapi?)` to register
  any route that inherits Halifax's full middleware stack: authentication, role enforcement
  (OR logic — any single match in `auth.roles` or `auth.permissions` grants access), content-type
  negotiation, structured error serialization, and `X-Correlation-ID` echo-back. The method can
  be called anywhere after `registerCrudApi()` — at startup or lazily from another module — and
  returns `this` for chaining. See [README_CUSTOM_ENDPOINTS.md](./README_CUSTOM_ENDPOINTS.md).

- **Duplicate endpoint detection** — `addCustomEndpoint` throws `ServerError` when the
  `method + path` combination is already registered, whether by Halifax's own generated CRUD
  routes or by a previous `addCustomEndpoint` call. This prevents silent route shadowing with
  a clear error message naming the conflicting method and path.

- **Live OpenAPI spec** — the `/openapi.json` spec is now serialized on each request
  (previously frozen as a string at startup), so endpoints added via `addCustomEndpoint`
  appear in the spec and Swagger UI immediately after registration. The optional `openapi`
  argument to `addCustomEndpoint` merges the full `OpenApiOperation` into the live spec
  with no restart and no additional configuration.

- **`SaleRecord` model in all integration test schemas** — a `sale_records` table
  (`id`, `category`, `amount`, `createdAt`) is added to all six Prisma integration schemas
  (Postgres, MySQL/MariaDB, SQL Server, CockroachDB, SQLite) to support the new custom-endpoint
  integration test suite, which exercises a real `GROUP BY category HAVING SUM(amount) >= ?`
  aggregate query via Prisma `groupBy` + `having`.

### Changed

- **`registerCrudApi` return type** — changed from `void` to `HalifaxApi`. All callers that
  ignored the return value continue to work without modification. Callers that assigned the
  return to a variable typed as `void` will need a minor type update.

- **`createExpressCrudRouter` unchanged** — this convenience wrapper continues to return an
  Express `Router` for backward compatibility. Users who need `addCustomEndpoint` should
  use `registerCrudApi(new ExpressHttpServer(router), resources, options)` directly.

## [2.5.0]

### Breaking

- **`CreateOptions` type and `idempotencyKey` removed** — the `CreateOptions` interface and the
  `options?: CreateOptions` parameter on `Repository.createOne` / `Repository.createMany` have
  been removed. The `idempotencyKey` field was never implemented by any built-in adapter; it
  existed only as a forward-looking placeholder. The `Idempotency-Key` HTTP header is no longer
  forwarded to repositories. Remove any references to `CreateOptions` or `idempotencyKey` from
  custom repository implementations.

- **`buildGraphQLSchema` is now `async`** — the function signature changed from
  `(contexts: GraphQLResourceContext[]) => GraphQLSchema` to
  `(contexts: GraphQLResourceContext[]) => Promise<GraphQLSchema>`. This is a change to an
  advanced low-level export; `registerCrudApi` / `createExpressCrudRouter` are unaffected.
  Direct callers must add `await`.

### Fixed

- **GraphQL peer dependency eagerly loaded at startup** — importing Halifax (even without
  enabling GraphQL) would crash the process when the optional `graphql` peer dependency was
  not installed. All `graphql` package imports in `schema.ts` and `registerGraphqlRoute.ts`
  are now dynamic (`await import('graphql')`) and only execute on the first GraphQL request.
  Applications that do not enable `graphql: { enabled: true }` are fully unaffected and
  never load the `graphql` module.

- **`graphiql.js` imported unnecessarily when GraphiQL is disabled** — the internal lazy-init
  block previously imported `./graphiql.js` unconditionally. It is now only imported when
  `graphiql` is `true` (the default), so disabling GraphiQL avoids loading the module entirely.

### Changed

- **Internal source reorganised into focused modules** — large files split for readability with
  no public API changes. `src/core/types.ts` remains a re-export barrel; all existing import
  paths are unaffected. New internal modules: `src/core/types/{http,field,repository,resource,prisma}.ts`,
  `src/openapi/{types,sharedSchemas,operations}.ts`, `src/graphql/{schemaHelpers,resourceResolvers}.ts`,
  `src/adapters/orm/prisma/{prismaUtils,tenantScoping}.ts`, `src/core/stringUtils.ts`. No file
  exceeds 500 lines.

- **`statusCodeMap` exported from `handlerUtils`** — previously private; GraphQL schema builder
  reuses it instead of maintaining a parallel copy, eliminating a REST/GraphQL error-code drift risk.

- **`src/graphql/scalars.ts` removed** — orphaned when the `GraphQLJSON` scalar was moved into
  `buildSchemaHelpers`. No longer shipped.

## [2.4.0]

### Breaking

- **`RouteHandlerContext.resolveRepo` and `GraphQLResourceContext.resolveRepo` now require a
  third `action: CrudAction` argument** — the resolver function signature has changed from
  `(req: HttpRequest, auth: AuthContext) => Promise<Repository>` to
  `(req: HttpRequest, auth: AuthContext, action: CrudAction) => Promise<Repository>`. The
  `action` parameter carries the name of the CRUD operation being performed (e.g. `'readMany'`,
  `'create'`) so that action-aware logic (such as the new admin bypass) can branch correctly
  inside the closure. All built-in handlers and resolvers pass the correct action. Custom
  integrations that construct a `RouteHandlerContext` or `GraphQLResourceContext` directly must
  update their `resolveRepo` implementation to accept and handle the third argument.

- **`GraphQLOptions.enabled` must now be explicitly set to `true`** — previously, supplying a
  `graphql: { ... }` object without `enabled: false` activated the endpoint. The new default is
  off: the endpoint is registered only when `graphql: { enabled: true, ... }` is passed. This
  makes GraphQL a deliberate opt-in and avoids importing the optional `graphql` peer dependency
  unless it is actually used. Existing configurations that relied on the implicit default must
  add `enabled: true`.

### Added

- **GraphQL endpoint** — Halifax can now expose a full GraphQL API alongside REST. The schema
  is built at startup from the same resource definitions that drive REST: no separate schema
  file, no annotations. For each resource Halifax generates `get<T>`, `list<T>`, and
  `query<T>` query fields plus `create<T>`, `createMany<T>`, `update<T>`, `updateMany<T>`,
  `upsert<T>`, `delete<T>`, and `deleteMany<T>` mutation fields — only those allowed by
  `resource.permissions` are included. The same auth strategy, tenant scoping, field-level
  security (`readRoles`/`writeRoles`), lifecycle hooks, and caching that apply to REST apply
  identically to GraphQL resolvers. Requires the optional `graphql` (≥ 16.0.0) peer dependency.

  ```ts
  createExpressCrudRouter(resources, {
    graphql: { enabled: true, path: '/graphql', graphiql: true }
  })
  ```

  - `GET /graphql` serves the GraphiQL browser IDE (disable with `graphiql: false`).
  - `requireAuth: true` gates even introspection behind `authStrategy.authenticate`.
  - Set `graphql: false` on any `ResourceDefinition` to exclude it from the schema while
    keeping it on REST.
  - See [README_GRAPHQL.md](./README_GRAPHQL.md) for full documentation and examples.

- **Admin tenant bypass** — callers whose `auth.roles` or `auth.permissions` matches any entry
  in `TenantOptions.bypassRoles` receive an unscoped repository for read operations
  (`readOne`, `readMany`, `readManyWithQueryBuilder`), allowing them to query across all
  tenants. Write operations (`create`, `updateOne`, `updateMany`, `upsertOne`, `deleteOne`,
  `deleteMany`) are never bypassed — the tenant value on writes continues to come from
  `resolveId`, keeping write provenance tied to authentication rather than client input.
  Admins who want to read a single tenant's data use the standard filter syntax
  (`?companyId=42` on REST, `filter: { companyId: 42 }` in GraphQL) rather than any special
  override mechanism.

  ```ts
  tenant: {
    resolveId: ({ auth }) => auth.claims?.companyId,
    bypassRoles: ['super_admin', 'support:read-all'],   // role OR permission slug
  }
  ```

  Per-resource override via `ResourceDefinition.bypassTenantRoles` takes precedence over the
  API-wide list. Set it to `[]` on a resource to prevent bypass entirely for that model even
  when a global `bypassRoles` is configured.

- **`README_GRAPHQL.md`** — new reference document covering GraphQL opt-in setup, the
  auto-generated schema (queries, mutations, types), per-resource opt-out, the GraphiQL IDE,
  authentication, tenant bypass behaviour, and annotated query/mutation examples.

## [2.3.0]

### Security

- **`PrismaAdapter.upsertOne` cross-tenant write vulnerability eliminated** — the previous scoped
  upsert path performed `findFirst({ where: { id } })` without a tenant filter, then called
  `delegate.upsert({ where: { id } })` also without a tenant filter. The application-level
  ownership check between the two statements created a TOCTOU window: if another tenant's record
  appeared at that ID between the check and the upsert, Prisma's `upsert` would fire its `update`
  branch and write into that other tenant's row. The scoped path no longer uses `delegate.upsert`.
  It now uses a scoped `findFirst(scopedWhere)` to detect existence, `updateMany(scopedWhere)` for
  the update branch (atomic, same fix applied to `updateOne`), and `create(stampTenant)` for the
  create branch. The `delegate.upsert` call is retained only for the unscoped path.

- **`PrismaAdapter.updateOne` and `deleteOne` unsafe fallbacks removed** — when `updateMany`
  (for `updateOne`) or `deleteMany` (for `deleteOne`) were unavailable on the delegate, the code
  fell back to a two-step scoped-check + unscoped-write sequence. Both halves now throw
  `ServerError` immediately rather than proceeding with an unsafe path. Standard Prisma delegates
  always expose both methods, so this only affects non-standard or mock delegates.

- **`requiredPermissions` now uses OR semantics consistently** — all three auth strategies
  (`JwtClaimsAuthStrategy`, `PassportJwtStrategy`, `PassportSessionStrategy`) previously used
  `.every()` (ALL permissions required), while the fallback path in `handlerUtils.ts` correctly
  used `.some()` (ANY single permission grants access). The strategies were wrong. All four paths
  now delegate to a shared `checkRequiredPermissions()` utility that applies `.some()` semantics:
  a caller who holds _any one_ of the listed permissions is authorized. This matches the documented
  behavior of `readRoles`/`writeRoles` at the field level and is a consistent read of "required
  permissions" as an OR list. **If you relied on the undocumented ALL-must-match behavior,
  tighten your permission model accordingly.**

- **TOCTOU race in `PrismaAdapter.updateOne` under tenant scope eliminated** — the previous
  scoped-update path did a `findFirst` ownership check and then a separate `update` call. Between
  the two statements, a concurrent request could transfer the record to a different tenant,
  allowing the update to land on a record the caller no longer owns. The fix uses
  `updateMany({ where: scopedWhere })` as the primary path when the Prisma delegate supports it —
  the tenant field is enforced atomically in a single SQL statement. A safe `findFirst`-then-update
  fallback remains only for delegates that lack `updateMany`.

### Performance

- **O(n²) → O(n) field validation** — `validateSelectableFields` and `validateSortableFields`
  previously called `.find()` inside a `.filter()`, giving O(n²) complexity per request. Both now
  pre-build a `Map` from field names to definitions and do O(1) lookups in the filter pass.

- **`makeReadableFieldFilter` factory for bulk-response field stripping** — `filterReadableFields`
  previously rebuilt the `fieldMap` `Map` and `userRoles` `Set` for every record in a batch. A
  new exported factory `makeReadableFieldFilter(resource, auth)` builds both structures once and
  returns a reusable `(record) => record` function. The `readMany`, `query`, and `updateMany`
  handlers now call the factory once before `.map()` and pass the compiled function directly,
  eliminating O(n) redundant Map constructions for responses with up to 5000 records.

- **`parseGetOneOptions` for lean GET /:id parsing** — `readOne` previously called
  `parseListOptions`, which parses and validates `?fields=`, `?include=`, `?limit=`, `?offset=`,
  `?order=`, and all filter fields — all of which are irrelevant to a single-record GET. A new
  exported `parseGetOneOptions(query, resource)` in `queryString.ts` only parses and validates
  `?fields=` and `?include=`, removing the wasted work and the silent discard of inapplicable
  parameters on that route.

### Fixed

- **OpenAPI `distinct` type corrected** — the query-builder endpoint's `distinct` parameter was
  documented as `{ type: 'boolean' }` in the generated spec. The actual type is `string[]` (an
  array of field names to de-duplicate on). The spec now documents it as
  `{ type: 'array', items: { type: 'string' } }` with an accurate description.

- **`normalizeEnvelope` and `mergeRelationDefinitions` extracted to `fields.ts`** — both
  utilities existed in identical form in `crudRouter.ts` and `specGenerator.ts`. They are now
  exported from `src/core/fields.ts` alongside `mergeFieldDefinitions`, and both files import
  from there. Behavior is unchanged.

- **`checkRequiredPermissions` extracted to `src/auth/strategies/types.ts`** — the permission
  check logic was duplicated (with incompatible `.every()` vs `.some()` semantics) across all
  three strategy files and `handlerUtils.ts`. It is now a single exported function and all four
  call sites use it. See the Security section above for the semantics fix.

- **`DrizzleAdapter` reports `supportsIncludes: false`** — the adapter has always silently ignored
  `?include=` requests because Drizzle has no built-in relation eager-loading surface compatible
  with Halifax's interface. The `capabilities` property now explicitly sets `supportsIncludes:
false`, which causes the router to reject `?include=` with `422 Unprocessable Entity` instead
  of silently returning records with no related data.

- **`InMemoryCacheStore` memory growth bounded** — the store previously only evicted expired
  entries lazily on reads, so a write-heavy workload with few reads could accumulate stale entries
  without bound. The `set()` method now runs a full expired-entry sweep every 200 writes
  (configurable via the `sweepEvery` constructor parameter). No external timers or additional
  dependencies.

- **`CacheStore.increment` — atomic cache version bumps** — `createCachingRepository` previously
  incremented the version key with a non-atomic `GET` + `SET`, creating a race window under
  concurrent writes on Redis. The `CacheStore` interface gains an optional `increment(key):
Promise<number> | number` method. `RedisCacheStore` implements it with Redis `INCR` (atomic
  by design). `InMemoryCacheStore` implements it synchronously (race-free in Node.js's
  single-threaded event loop). `createCachingRepository` uses `store.increment` when available
  and falls back to the non-atomic path only for custom stores that do not implement it.

- **`DrizzleAdapter.upsertOne` non-atomicity documented** — the method does a `getOne` check
  followed by a `createOne` or `updateOne`, which is non-atomic under concurrent load. A JSDoc
  comment now explains the race condition and recommends implementing a custom repository with a
  database-native `INSERT … ON CONFLICT` clause when true atomicity is required.

- **`PrismaAdapter` import order** — all imports were moved above function definitions and
  consolidated into a single, alphabetized block. No behavior change.

- **`parseId` dead code removed** — after `validateId(raw)` narrows `raw` to `string`, the
  previous `typeof raw === 'string' ? parseInt(raw, 10) : raw` branch was unreachable. The
  function now calls `parseInt(raw, 10)` directly, and the redundant type guard before the
  UUID/ObjectId check is also removed.

- **`LIKE` interior-wildcard limitation documented** — `likeToPrisma` in
  `src/adapters/orm/prisma/astToPrisma.ts` now carries a JSDoc comment explaining that patterns
  with an interior wildcard (e.g. `'foo%bar'`) cannot be expressed via Prisma's string operators
  and fall through to an exact `equals` match, not a wildcard match. Use `CONTAINS`, `STARTS
WITH`, or `ENDS WITH` comparisons instead of `LIKE` when possible.

### Documentation

- **`QueryBuilder` mutability warning** — the class JSDoc now clearly states that all chaining
  methods mutate `this` and return the same instance. A before/after code example demonstrates
  the correct pattern (create a new `QueryBuilder` per branch) and the incorrect pattern (sharing
  one instance and calling `.limit()` twice).

- **`andGroup` / `orGroup` API design explained** — both methods require a `field`/`comparison`/
  `value1` parent condition because the Halifax query AST attaches children to a parent filter
  node. The JSDoc now explains this constraint, describes what the resulting predicate looks like
  (`cond AND (children)` vs `cond OR (children)`), and suggests a workaround for expressing a
  pure parenthesized group with no meaningful parent condition.

- **`specGenerator` raw-vs-normalized resource note** — a comment in `generateOpenApiSpec`
  explains that the function operates on raw `ResourceDefinition` objects (not the normalized
  forms produced by `crudRouter.normalizeResource`) and therefore re-derives merged fields and
  relations independently. This is intentional — the spec generator is also usable as a
  standalone function outside the router.

## [2.2.3]

### Added

- **`ConflictError`** — new `HttpError` subclass with HTTP status `409`. Exported from
  the main package entry-point so application code can `throw new ConflictError()` in
  hooks or custom repositories and have it serialised correctly.

### Fixed

- **409 Conflict on duplicate unique-key violations** — `PrismaAdapter` and `DrizzleAdapter`
  now catch unique-constraint errors from the underlying ORM and re-throw them as
  `ConflictError` (HTTP 409) instead of letting the raw ORM error propagate as an
  unhandled 500.
  - **Prisma**: catches `P2002` (unique constraint failed) on `createOne`, `createMany`,
    `updateOne`, and both branches of `upsertOne`.
  - **Drizzle**: catches PostgreSQL `23505`, MySQL `1062` / `ER_DUP_ENTRY`, and SQLite
    `UNIQUE constraint failed` on `createOne`, `createMany`, and `updateOne`.
- **`statusCodeMap` now includes `409 → 'CONFLICT'`** — previously, any `HttpError`
  thrown with status `409` would have been serialised with `code: "INTERNAL_ERROR"`.

### Changed

- **OpenAPI spec** — write operations (`POST /{resource}`, `PATCH /{resource}`,
  `PATCH /{resource}/{id}`, `PUT /{resource}/{id}`) now include a `409 Conflict` response
  definition documenting that unique-constraint violations return this status.

## [2.2.2]

### Fixed

- Removed the `preinstall` script from both `@edium/halifax` and `@edium/halifax-client`. The
  script was a developer-convenience guard that enforced pnpm usage inside the monorepo, but because it shipped in the published package it caused npm (v7+) to prompt consumers with an "approve build scripts" confirmation on every install. End-users no longer need to approve anything to install either package.

## [2.2.1]

### Added

- Published `README.md` files for `@edium/halifax-client` and `@edium/halifax-types` — both
  packages now ship documentation with the npm tarball.

### Fixed

- `@edium/halifax-types` was re-versioned from `0.1.0` to `2.2.1` to align with the rest of
  the suite. Consumers importing from this package directly should update their version
  constraint accordingly.

## [2.2.0]

### Added

- **Lifecycle hooks** — inject custom logic before or after any CRUD operation by setting
  `hooks` on `ResourceDefinition`. All 18 hooks cover every operation the auto-CRUD engine
  exposes:

  | Category        | Hooks                                 |
  | --------------- | ------------------------------------- |
  | Create          | `beforeCreate`, `afterCreate`         |
  | Read (list)     | `beforeReadMany`, `afterReadMany`     |
  | Read (single)   | `beforeReadOne`, `afterReadOne`       |
  | Update (single) | `beforeUpdateOne`, `afterUpdateOne`   |
  | Update (bulk)   | `beforeUpdateMany`, `afterUpdateMany` |
  | Upsert          | `beforeUpsertOne`, `afterUpsertOne`   |
  | Delete (single) | `beforeDeleteOne`, `afterDeleteOne`   |
  | Delete (bulk)   | `beforeDeleteMany`, `afterDeleteMany` |
  | Query builder   | `beforeQuery`, `afterQuery`           |

  **Before hooks** can return a modified data object (replacing the incoming payload) or
  `void` to leave it unchanged. Throwing any `Error` aborts the operation and sends the
  correct HTTP error response — use Halifax error classes (`AuthorizationError`,
  `BadRequestError`, `UnprocessableEntityError`, …) for precise status codes.

  **After hooks** can return a modified result (replacing what is sent to the client) or
  `void`. They run after the database write but before response field-filtering
  (`readRoles` / `selectable`), so they see every field the DB returned.

  Every hook receives a `HookContext` as its last argument: `{ auth, resource, req }`.

  Common patterns: stamping `createdBy` / `updatedBy` from auth context, emitting domain
  events, enforcing ownership checks beyond what `AuthStrategy` provides, restricting
  query-builder results to the caller's own data, and soft-delete read interception.

  See [README_HOOKS.md](./README_HOOKS.md) for the full reference and examples.

- **OpenAPI 3.1 spec generation** — pass an `openapi` object to `createExpressCrudRouter` / `registerCrudApi` and Halifax generates a complete spec from your registered resources at startup. No manual annotation needed. Routes for `GET /openapi.json` and `GET /docs` (Swagger UI) are registered automatically at your mount point.
  - Field types are introspected from the Prisma DMMF (`PrismaAdapter`) and from Drizzle column metadata (`DrizzleAdapter`) with no extra configuration. Custom / non-ORM repositories annotate individual fields with optional `type` and `format` on `FieldDefinition`.
  - The spec documents exactly the operations your `permissions` allow — disabled actions are omitted entirely.
  - Query-string parameters, request/response schemas, error shapes, and envelope wrapping are all reflected accurately.
  - Auth is wired automatically: `ApiKeyAuthStrategy`, `JwtClaimsAuthStrategy`, `PassportJwtStrategy`, `Auth0JwtStrategy`, and `FirebaseJwtStrategy` each contribute the correct security scheme; `AllowAllAuthStrategy` produces no security requirement. Override with `openApiScheme()` on a custom strategy, or pass `securityScheme` directly in `openapi` options.
  - Gate docs behind an environment check with `enabled: process.env.NODE_ENV !== 'production'` — when `enabled` is `false` (or the `openapi` key is omitted), no routes are registered and the generator is never called.
  - Custom spec and docs paths via `specPath` and `docsPath`.
  - `generateOpenApiSpec(resources, options)` is exported standalone for CI validation, static hosting, or piping into code generators.
  - See [README_OPENAPI.md](./README_OPENAPI.md) for full documentation.

- **`@edium/halifax-client` companion package** — a typed browser/Node client that lives alongside this package in the same repository. Zero runtime dependencies. Bring your own HTTP client (native `fetch`, axios, ky, ofetch, or superagent — each ships a ready-made transport adapter). Features: typed CRUD methods, a fluent `QueryBuilder` that compiles to the server's query AST, and full TanStack Query integration (read query options + mutation options with auto-invalidation) built directly into `ResourceClient`. See the [client README](../halifax-client/README.md) for details.

- **Drizzle ORM adapter** — `DrizzleAdapter<TRecord, TCreate, TUpdate>` implements the full `Repository` interface against any Drizzle-compatible database (PostgreSQL, MySQL, SQLite, LibSQL). Import from the `@edium/halifax/drizzle` sub-path export; `drizzle-orm` is an optional peer dependency and is never required when unused.
  - Field schema and OpenAPI types are derived automatically via `getTableColumns()` — no `fields` array needed.
  - All Halifax query-AST operators are compiled to native Drizzle SQL expressions (never raw strings).
  - Multi-tenant isolation via `withScope()` and full `executeQuery()` (query-builder endpoint) support.
  - Primary key is auto-detected from the table schema; override with `config.idField` when using composite keys or non-standard names.
  - See [README_REPO_ADAPTERS.md](./README_REPO_ADAPTERS.md) for usage.

- **Per-field role-based access control** — `FieldDefinition` gains two optional arrays:
  - `readRoles: string[]` — callers whose `auth.roles` or `auth.permissions` contain none of these strings have the field stripped from every response (getOne, getMany, query, and the results of create/update/upsert). Applied at the response boundary — no extra DB round-trips.
  - `writeRoles: string[]` — callers lacking a matching role have the field silently dropped from write bodies (same effect as `writable: false` for that caller). Callers with a matching role can write the field normally.
  - Roles are matched against both `auth.roles` and `auth.permissions` for consistency with `requiredPermissions`.
  - See [README_AUTH.md](./README_AUTH.md) for usage.

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

[3.0.0]: https://github.com/splayfee/halifax/releases/tag/v3.0.0
[2.7.0]: https://github.com/splayfee/halifax/releases/tag/v2.7.0
[2.6.0]: https://github.com/splayfee/halifax/releases/tag/v2.6.0
[2.5.0]: https://github.com/splayfee/halifax/releases/tag/v2.5.0
[2.4.0]: https://github.com/splayfee/halifax/releases/tag/v2.4.0
[2.3.0]: https://github.com/splayfee/halifax/releases/tag/v2.3.0
[2.2.3]: https://github.com/splayfee/halifax/releases/tag/v2.2.3
[2.2.2]: https://github.com/splayfee/halifax/releases/tag/v2.2.2
[2.2.1]: https://github.com/splayfee/halifax/releases/tag/v2.2.1
[2.2.0]: https://github.com/splayfee/halifax/releases/tag/v2.2.0
[2.1.0]: https://github.com/splayfee/halifax/releases/tag/v2.1.0
[2.0.0]: https://github.com/splayfee/halifax/releases/tag/v2.0.0
