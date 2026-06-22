# Interfaces — `@edium/halifax`

All publicly exported TypeScript interfaces, grouped by concern. Type aliases are in [README_TYPES.md](./README_TYPES.md); classes are in [README_CLASSES.md](./README_CLASSES.md).

---

## Resource definition

### `ResourceDefinition<TRecord, TCreate, TUpdate>`

Import: `@edium/halifax`

Full definition of a Halifax resource. Pass an array of these to `createExpressCrudRouter` / `registerCrudApi`.

| Property              | Type                                    | Required | Description                                                                                                                                                                                                                                |
| --------------------- | --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `routePrefix`         | `string`                                | yes      | URL path segment (e.g. `'users'`, `'blog-posts'`). Defines the resource's public routes.                                                                                                                                                   |
| `repository`          | `Repository<TRecord, TCreate, TUpdate>` | yes      | The data adapter that handles reads and writes.                                                                                                                                                                                            |
| `name`                | `string`                                | no       | Human-readable name used in error messages. Defaults to title-cased `routePrefix` (`'blog-posts'` → `'Blog Posts'`).                                                                                                                       |
| `fields`              | `FieldDefinition[]`                     | no\*     | Field schema — controls filtering, sorting, selection, and write access. Optional when the repository exposes its own schema (Prisma/Drizzle); required otherwise. Merged by name over the repository's base schema when both are present. |
| `relations`           | `RelationDefinition[]`                  | no       | Relations exposed via `?include=`. Merged over the repository's relation schema by name.                                                                                                                                                   |
| `tenant`              | `TenantResourceConfig \| false`         | no       | Tenant isolation for this resource. `false` explicitly opts out of an otherwise tenant-scoped API.                                                                                                                                         |
| `permissions`         | `CrudPermissions`                       | no       | Per-action enables/disables. Merged over `defaultCrudPermissions` — list only the actions to disable.                                                                                                                                      |
| `requiredPermissions` | `Partial<Record<CrudAction, string[]>>` | no       | Permission strings per action checked by the auth strategy.                                                                                                                                                                                |
| `defaultLimit`        | `number`                                | no       | Default page size when caller omits `?limit=`. Defaults to `DEFAULT_PAGE_LIMIT` (5000). `0` disables the default bound.                                                                                                                    |
| `maxLimit`            | `number`                                | no       | Hard cap on page size. Defaults to `MAX_PAGE_LIMIT` (5000). `0` removes the cap.                                                                                                                                                           |
| `maxFilterDepth`      | `number`                                | no       | Maximum nesting depth for `where` clause children. Defaults to 4.                                                                                                                                                                          |
| `cache`               | `ResourceCacheConfig \| false`          | no       | Per-resource cache TTL. `false` disables caching even when an API-wide default is set.                                                                                                                                                     |
| `envelope`            | `string \| null`                        | no       | Wraps every success response body under this key (e.g. `'data'`). Overrides the API-wide `envelope` option.                                                                                                                                |
| `graphql`             | `boolean`                               | no       | When `false`, excludes this resource from the auto-generated GraphQL schema while keeping it on REST. Defaults to `true` when GraphQL is enabled.                                                                                          |
| `bypassTenantRoles`   | `string[]`                              | no       | Roles or permission slugs whose holders bypass tenant scoping for read operations on this resource. Overrides `TenantOptions.bypassRoles`. Set to `[]` to prevent bypass on this resource even when a global list is configured.           |

---

### `FieldDefinition`

Import: `@edium/halifax`

Describes a single column exposed through the Halifax API. All flags default to `true` (permissive); set one to `false` to restrict. The primary key is automatically non-writable.

| Property     | Type        | Description                                                                                                                                                                          |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`       | `string`    | Column / property name.                                                                                                                                                              |
| `filterable` | `boolean`   | When `false`, cannot be used in `?field=` query-string filters.                                                                                                                      |
| `sortable`   | `boolean`   | When `false`, cannot be used in `?order=` sort expressions.                                                                                                                          |
| `selectable` | `boolean`   | When `false`, excluded from `?fields=` projections.                                                                                                                                  |
| `writable`   | `boolean`   | When `false`, stripped from POST/PATCH/PUT bodies. Primary key defaults to `false`.                                                                                                  |
| `type`       | `FieldType` | OpenAPI scalar type. Auto-populated by Prisma/Drizzle adapters; set manually for custom repos.                                                                                       |
| `format`     | `string`    | OpenAPI format modifier (e.g. `'date-time'`, `'int64'`, `'binary'`).                                                                                                                 |
| `readRoles`  | `string[]`  | Roles or permissions required to read this field. Callers without a match have the field stripped from responses. Matched against `AuthContext.roles` and `AuthContext.permissions`. |
| `writeRoles` | `string[]`  | Roles or permissions required to write this field. Callers without a match have the field silently dropped from write bodies.                                                        |

---

### `RelationDefinition`

Import: `@edium/halifax`

Declares a relation that callers may eager-load via `?include=`.

| Property     | Type      | Description                                                                          |
| ------------ | --------- | ------------------------------------------------------------------------------------ |
| `name`       | `string`  | Relation name as defined on the Prisma/ORM model.                                    |
| `includable` | `boolean` | When `false`, this relation cannot be requested via `?include=`. Defaults to `true`. |

---

### `CrudPermissions`

Import: `@edium/halifax`

Per-action toggles controlling which CRUD endpoints are registered for a resource. All actions default to `true` **except the bulk writes `allowUpdateMany` and `allowDeleteMany`, which default to `false`** (3.0.0, secure-by-default). List the single-record actions you want to disable, and set a bulk flag to `true` to opt into it.

| Property                        | Default | Route affected          |
| ------------------------------- | ------- | ----------------------- |
| `allowCreate`                   | `true`  | `POST /:resource`       |
| `allowReadOne`                  | `true`  | `GET /:resource/:id`    |
| `allowReadMany`                 | `true`  | `GET /:resource`        |
| `allowReadManyWithQueryBuilder` | `true`  | `POST /:resource/query` |
| `allowUpdateOne`                | `true`  | `PATCH /:resource/:id`  |
| `allowUpdateMany`               | `true`  | `PATCH /:resource`      |
| `allowUpsertOne`                | `true`  | `PUT /:resource/:id`    |
| `allowDeleteOne`                | `true`  | `DELETE /:resource/:id` |
| `allowDeleteMany`               | `true`  | `DELETE /:resource`     |

---

### `ResourceCacheConfig`

Import: `@edium/halifax`

Per-resource read-through cache configuration. Set on `ResourceDefinition.cache`.

| Property     | Type     | Description                                                                             |
| ------------ | -------- | --------------------------------------------------------------------------------------- |
| `ttlSeconds` | `number` | Cache TTL in seconds. `0` means never expire (cache forever until a write invalidates). |

---

### `TenantResourceConfig`

Import: `@edium/halifax`

Declares that a resource is tenant-scoped. Set on `ResourceDefinition.tenant`.

| Property | Type     | Description                                                                                                                                                                    |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `field`  | `string` | Column / property that stores the tenant key (e.g. `'companyId'`). Every read and write is confined to rows whose value on this field matches the caller's resolved tenant id. |

---

## API options

### `CrudApiOptions`

Import: `@edium/halifax`

Options for `registerCrudApi` and all `create*CrudRouter` / `create*CrudPlugin` functions.

| Property           | Type             | Description                                                                                                                                        |
| ------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authStrategy`     | `AuthStrategy`   | Auth strategy for all routes. Defaults to `AllowAllAuthStrategy`.                                                                                  |
| `tenant`           | `TenantOptions`  | Multi-tenant isolation config. When omitted, no tenant scoping is applied.                                                                         |
| `queryBuilderPath` | `string`         | Path segment for the query-builder POST route (default: `'query'`). Must match `HalifaxClientOptions.queryBuilderPath` in `@edium/halifax-client`. |
| `envelope`         | `string \| null` | Wraps every success response body under this key API-wide. Per-resource `ResourceDefinition.envelope` takes precedence.                            |
| `openapi`          | `OpenApiOptions` | Enable OpenAPI 3.1 spec generation and Swagger UI. Omit to disable entirely.                                                                       |
| `cache.store`      | `CacheStore`     | Backing cache store shared by all resources. Defaults to `InMemoryCacheStore`.                                                                     |
| `cache.ttlSeconds` | `number`         | Default TTL applied to resources with no per-resource cache config. `0` = never expire.                                                            |
| `cache.bustHeader` | `string`         | Request header that force-refreshes the cache. Defaults to `'Cache-Control'` (busts on `no-cache`/`no-store`).                                     |

---

### `OpenApiOptions`

Import: `@edium/halifax`

Configuration for OpenAPI 3.1 spec generation. Set on `CrudApiOptions.openapi`.

| Property         | Type                                           | Default            | Description                                                                                |
| ---------------- | ---------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `enabled`        | `boolean`                                      | `true`             | Set `false` to disable entirely — no routes registered, no spec generated.                 |
| `title`          | `string`                                       | `'Halifax API'`    | API title shown in Swagger UI.                                                             |
| `version`        | `string`                                       | `'1.0.0'`          | API version string.                                                                        |
| `description`    | `string`                                       | —                  | Markdown description shown at the top of the docs.                                         |
| `servers`        | `Array<{ url: string; description?: string }>` | —                  | Server URLs listed in the spec.                                                            |
| `envelope`       | `string \| null`                               | —                  | Mirrors `CrudApiOptions.envelope` for the spec — auto-propagated; only override if needed. |
| `specPath`       | `string`                                       | `'/openapi.json'`  | Path for the raw spec, relative to the router mount point.                                 |
| `docsPath`       | `string`                                       | `'/docs'`          | Path for the Swagger UI page, relative to the router mount point.                          |
| `securityScheme` | `SecurityScheme`                               | Auto from strategy | Overrides the security scheme reported by the `authStrategy`.                              |

---

## Auth

### `AuthStrategy`

Import: `@edium/halifax`

Contract for pluggable authentication and authorization strategies. Implement this to create a custom strategy.

| Member            | Signature                                                        | Required | Description                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticate`    | `(req: HttpRequest) => AuthContext \| Promise<AuthContext>`      | yes      | Authenticate the request. Throw `AuthenticationError` (→ 401) or `AuthorizationError` (→ 403) on failure.                                                                               |
| `authorize`       | `(params: AuthorizeParams) => boolean \| Promise<boolean>`       | no       | Gate each **auto-CRUD** action against the auth context. When absent, Halifax checks `requiredPermissions` against `auth.roles`/`auth.permissions` directly.                            |
| `authorizeCustom` | `(params: CustomAuthorizeParams) => boolean \| Promise<boolean>` | no       | Gate each **custom endpoint** against the auth context. When absent, Halifax uses the flat OR-match of the endpoint's `roles`. Lets a strategy apply a role hierarchy to custom routes. |
| `openApiScheme`   | `() => SecurityScheme \| undefined`                              | no       | Return the security scheme to document in the OpenAPI spec (wires up the Swagger UI "Authorize" button).                                                                                |

---

### `AuthContext`

Import: `@edium/halifax`

Resolved user identity returned by `AuthStrategy.authenticate`.

| Property          | Type                      | Description                                                                                           |
| ----------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `isAuthenticated` | `boolean`                 | Always `true` for a successfully authenticated context.                                               |
| `userId`          | `string`                  | Unique identifier for the authenticated user.                                                         |
| `roles`           | `string[]`                | Role strings granted to the user. Checked against `requiredPermissions` and `readRoles`/`writeRoles`. |
| `permissions`     | `string[]`                | Explicit permission strings. Checked alongside `roles`.                                               |
| `claims`          | `Record<string, unknown>` | Raw claims from the token or session payload.                                                         |

---

### `AuthorizeParams`

Import: `@edium/halifax`

Passed to `AuthStrategy.authorize` on every request.

| Property              | Type                 | Description                                            |
| --------------------- | -------------------- | ------------------------------------------------------ |
| `auth`                | `AuthContext`        | The resolved authentication context.                   |
| `action`              | `CrudAction`         | The CRUD action being performed.                       |
| `resource`            | `ResourceDefinition` | The resource being accessed.                           |
| `requiredPermissions` | `string[]`           | Permissions required for this action on this resource. |
| `req`                 | `HttpRequest`        | The incoming HTTP request.                             |

---

### `CustomAuthorizeParams`

Import: `@edium/halifax`

Passed to `AuthStrategy.authorizeCustom` for every custom endpoint (the custom-endpoint counterpart of `AuthorizeParams`). A custom endpoint has no CRUD action or resource, so authorization is keyed on the route.

| Property              | Type                                              | Description                                                            |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| `auth`                | `AuthContext`                                     | The resolved authentication context.                                   |
| `method`              | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | The HTTP verb of the custom endpoint.                                  |
| `path`                | `string`                                          | The endpoint's route path (e.g. `'/orders/:id/fulfill'`).              |
| `requiredPermissions` | `string[]`                                        | The roles/permissions declared on the endpoint (its `roles` argument). |
| `req`                 | `HttpRequest`                                     | The incoming HTTP request.                                             |

---

### `CustomEndpointOptions`

Import: `@edium/halifax`

The options-bag argument to `HalifaxApi.addCustomEndpoint(method, path, options, handler)`. Every field is optional; defaults reproduce the positional `roles`-array call.

| Property               | Type                                                                            | Default                | Description                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `roles`                | `string[] \| null`                                                              | `[]`                   | Roles/permissions (OR logic). `[]` → any authenticated caller; `null` → **public** (auth skipped).      |
| `auth`                 | `boolean`                                                                       | `true`                 | `false` makes the endpoint public (same as `roles: null`).                                              |
| `authorize`            | `(ctx: { auth: AuthContext; req: HttpRequest }) => boolean \| Promise<boolean>` | —                      | One-off authorization predicate. When set, the **sole** gate (overrides `roles` + `authorizeCustom`).   |
| `useStrategyAuthorize` | `boolean`                                                                       | `true`                 | Route role-gating through `AuthStrategy.authorizeCustom` when available. `false` forces the flat match. |
| `consumes`             | `string[]`                                                                      | `['application/json']` | Accepted request `Content-Type`s (e.g. `['multipart/form-data']`).                                      |
| `produces`             | `string[]`                                                                      | `['application/json']` | Response types negotiated against `Accept` (e.g. `['application/pdf']`).                                |
| `openapi`              | `CustomEndpointOpenApi`                                                         | —                      | OpenAPI 3.1 metadata merged into the live spec.                                                         |

---

### `PassportJwtStrategyOptions`

Import: `@edium/halifax`

Options for `PassportJwtStrategy`.

| Property   | Type                             | Default        | Description                                                                                                   |
| ---------- | -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| `passport` | `PassportLike`                   | required       | A Passport instance with a JWT strategy registered.                                                           |
| `strategy` | `string`                         | `'jwt'`        | Name of the Passport strategy to invoke.                                                                      |
| `mapUser`  | `(user: unknown) => AuthContext` | Default mapper | Maps the raw Passport user payload to an `AuthContext`. Default reads `sub`/`id`, `roles`, and `permissions`. |

---

### `PassportLike`

Import: `@edium/halifax`

Minimal structural type for a Passport.js instance. Avoids a hard dependency on `passport`.

| Method         | Signature                                     | Description                                       |
| -------------- | --------------------------------------------- | ------------------------------------------------- |
| `authenticate` | `(strategy, options, callback) => middleware` | Authenticates a request using the named strategy. |

---

## Multi-tenancy

### `TenantOptions`

Import: `@edium/halifax`

Configures multi-tenant isolation API-wide. Set on `CrudApiOptions.tenant`.

| Property      | Type                                                         | Default      | Description                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveId`   | `(ctx: TenantResolveContext) => unknown \| Promise<unknown>` | required     | Resolves the tenant key from the auth context and request. Must come from the token/session — never from client input. Return `null`/`undefined` when none applies.                                                                      |
| `field`       | `string`                                                     | `'tenantId'` | Default column name for auto-detection: resources with a field of this name are automatically scoped on it.                                                                                                                              |
| `strict`      | `boolean`                                                    | `true`       | When `true`, a tenant-scoped resource whose `resolveId` returns no value rejects with 403 rather than serving unscoped.                                                                                                                  |
| `bypassRoles` | `string[]`                                                   | —            | Roles or permission slugs (matched against `auth.roles` OR `auth.permissions`) whose holders receive unscoped reads across all tenants. Writes are never bypassed. Per-resource `ResourceDefinition.bypassTenantRoles` takes precedence. |

---

### `TenantResolveContext`

Import: `@edium/halifax`

Passed to `TenantOptions.resolveId` on every request.

| Property   | Type                 | Description                          |
| ---------- | -------------------- | ------------------------------------ |
| `auth`     | `AuthContext`        | The resolved authentication context. |
| `req`      | `HttpRequest`        | The incoming HTTP request.           |
| `resource` | `ResourceDefinition` | The resource being accessed.         |

---

### `TenantScope`

Import: `@edium/halifax`

A resolved tenant constraint for a single request. Produced by the router and passed to `Repository.withScope`.

| Property | Type      | Description                                             |
| -------- | --------- | ------------------------------------------------------- |
| `field`  | `string`  | Column that stores the tenant key (e.g. `'companyId'`). |
| `value`  | `unknown` | The tenant key value the caller is bound to.            |

---

## HTTP

### `HttpServer`

Import: `@edium/halifax`

Contract an HTTP server adapter must implement for Halifax to register routes. Implement this to add a new HTTP framework.

| Method          | Signature                                                               | Description               |
| --------------- | ----------------------------------------------------------------------- | ------------------------- |
| `registerRoute` | `(method: HttpMethod, path: string, handler: HttpRouteHandler) => void` | Register a route handler. |
| `start`         | `(port: number, host?: string) => Promise<void> \| void`                | Start listening.          |

---

### `HttpRequest<TRaw>`

Import: `@edium/halifax`

Framework-agnostic representation of an incoming HTTP request, passed to all handlers and auth strategies.

| Property  | Type                                              | Description                                                                                                   |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `method`  | `string`                                          | HTTP method (`'GET'`, `'POST'`, etc.).                                                                        |
| `params`  | `Record<string, string>`                          | Route parameters (e.g. `{ id: '42' }`).                                                                       |
| `query`   | `Record<string, unknown>`                         | Parsed query-string parameters.                                                                               |
| `body`    | `unknown`                                         | Parsed request body.                                                                                          |
| `headers` | `Record<string, string \| string[] \| undefined>` | Request headers.                                                                                              |
| `raw`     | `TRaw`                                            | Underlying raw request object from the framework (e.g. Express `Request`). Used by `PassportSessionStrategy`. |

---

### `HttpResponse<TRaw>`

Import: `@edium/halifax`

Framework-agnostic representation of an outgoing HTTP response.

| Member      | Signature                                      | Description                                        |
| ----------- | ---------------------------------------------- | -------------------------------------------------- |
| `status`    | `(code: number) => HttpResponse`               | Set the HTTP status code (chainable).              |
| `json`      | `(payload: unknown) => void \| Promise<void>`  | Serialize and send the response as JSON.           |
| `send`      | `(payload?: unknown) => void \| Promise<void>` | Send a raw response body (optional).               |
| `setHeader` | `(name: string, value: string) => void`        | Set a response header (optional).                  |
| `raw`       | `TRaw`                                         | Underlying raw response object from the framework. |

---

### HTTP framework structural interfaces

These are duck-typed so Halifax has no hard dependencies on specific framework packages.

| Interface                | Import path      | Description                                                                                                                          |
| ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ExpressAppLike`         | `@edium/halifax` | Minimal structural type for an Express `Application`. Requires `use`, `get`, `post`, `put`, `patch`, `delete`, `all`, and `listen`.  |
| `FastifyAppLike`         | `@edium/halifax` | Minimal structural type for a Fastify instance. Requires `get`, `post`, `put`, `patch`, `delete`, `all`, and `listen`.               |
| `HyperExpressAppLike`    | `@edium/halifax` | Minimal structural type for a HyperExpress `Server`. Requires `use`, `get`, `post`, `put`, `patch`, `delete`, `any`, and `listen`.   |
| `UltimateExpressAppLike` | `@edium/halifax` | Minimal structural type for an Ultimate Express `App`. Requires `use`, `get`, `post`, `put`, `patch`, `delete`, `all`, and `listen`. |

---

## Repository

### `Repository<TRecord, TCreate, TUpdate>`

Import: `@edium/halifax`

Core data-access contract. Implement this interface to create a custom repository adapter.

| Member         | Type                                                  | Required | Description                                                                                                           |
| -------------- | ----------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `capabilities` | `Partial<RepositoryCapabilities>`                     | no       | Declares which optional operations the adapter supports.                                                              |
| `fields`       | `FieldDefinition[]`                                   | no       | Field schema exposed to Halifax. When present, `ResourceDefinition.fields` are merged over these as sparse overrides. |
| `relations`    | `RelationDefinition[]`                                | no       | Relations for `?include=`.                                                                                            |
| `idField`      | `string`                                              | no       | Primary key field name. Defaults to `'id'`.                                                                           |
| `getOne`       | `(id, options?) => Promise<TRecord \| null>`          | yes      | Fetch a single record by primary key.                                                                                 |
| `getMany`      | `(options?) => Promise<ListResult<TRecord>>`          | yes      | Fetch a paginated, filtered list.                                                                                     |
| `createOne`    | `(data, options?) => Promise<TRecord>`                | yes      | Insert and return a single record.                                                                                    |
| `createMany`   | `(data[], options?) => Promise<TRecord[]>`            | yes      | Insert multiple records.                                                                                              |
| `updateOne`    | `(id, data) => Promise<TRecord \| null>`              | yes      | Partially update a record by primary key.                                                                             |
| `deleteOne`    | `(id) => Promise<boolean>`                            | yes      | Delete a record by primary key.                                                                                       |
| `updateMany`   | `(query, data) => Promise<UpdateManyResult<TRecord>>` | no       | Bulk-update matching records (query AST).                                                                             |
| `upsertOne`    | `(id, data) => Promise<TRecord>`                      | no       | Insert or replace a record by primary key.                                                                            |
| `deleteMany`   | `(query) => Promise<DeleteManyResult>`                | no       | Bulk-delete matching records (query AST).                                                                             |
| `executeQuery` | `(query) => Promise<QueryResult<TRecord>>`            | no       | Execute a raw query-builder AST.                                                                                      |
| `withScope`    | `(scope: TenantScope) => Repository<...>`             | no       | Return a scoped clone for tenant isolation. Must be implemented for tenant-scoped resources.                          |

---

### `RepositoryCapabilities`

Import: `@edium/halifax`

Flags declaring which optional operations a repository adapter supports.

| Property                   | Type      | Description                                                                                                        |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `supportsIncludes`         | `boolean` | When `false`, the router rejects any `?include=` request with 422 rather than silently ignoring it.                |
| `supportsCreateManyReturn` | `boolean` | When `true`, `createMany` returns the created records. When `false`, it returns an empty array (bulk insert path). |

---

### `ListOptions`

Import: `@edium/halifax`

Options passed to `Repository.getMany`.

| Property  | Type                                                   | Description                                                                       |
| --------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `fields`  | `string[]`                                             | Columns to return. Returns all columns when omitted.                              |
| `where`   | `Record<string, unknown>`                              | Key–value pairs applied as equality filters (or `{ in: [...] }` for multi-value). |
| `limit`   | `number`                                               | Maximum number of records to return.                                              |
| `offset`  | `number`                                               | Number of records to skip for pagination.                                         |
| `orderBy` | `Array<{ field: string; direction: 'asc' \| 'desc' }>` | Sort expressions.                                                                 |
| `include` | `string[]`                                             | Relation names to eager-load.                                                     |

---

## Cache

### `CacheStore`

Import: `@edium/halifax`

Contract for pluggable cache backends. Implement this to use Redis, Memcached, or any other store.

| Method      | Signature                                             | Description                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get`       | `(key: string) => Promise<unknown> \| unknown`        | Read a cached value. Returns `undefined` when absent or expired.                                                                                                                                  |
| `set`       | `(key, value, ttlSeconds?) => Promise<void> \| void`  | Write a value. `ttlSeconds` `0` or omitted means no expiry.                                                                                                                                       |
| `delete`    | `(key: string) => Promise<void> \| void`              | Delete a cached value.                                                                                                                                                                            |
| `increment` | `(key: string) => Promise<number> \| number` _(opt.)_ | Atomically increment an integer key and return the new value. Implement this for safe concurrent version bumps (e.g. Redis `INCR`). When omitted, Halifax falls back to a non-atomic `get`+`set`. |

---

### `CachingRepositoryOptions`

Import: `@edium/halifax`

Options for `createCachingRepository`.

| Property     | Type         | Description                                                                                                     |
| ------------ | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `store`      | `CacheStore` | Backing cache store.                                                                                            |
| `ttlSeconds` | `number`     | TTL for cached reads. `0` = never expire.                                                                       |
| `namespace`  | `string`     | Key prefix unique to this (resource, tenant) pair — ensures tenant isolation in a shared cache.                 |
| `bust`       | `boolean`    | When `true`, bypass the cache for this request and overwrite the entry. Set from the cache-bust request header. |

---

### `RedisLikeClient`

Import: `@edium/halifax`

Minimal structural type for a Redis client. `RedisCacheStore` uses this interface so no specific Redis package is a hard dependency. `redis` v4's `get`, `set`, and `del` satisfy it directly.

| Method | Signature                                       | Description                                                                                                            |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `get`  | `(key: string) => Promise<string \| null>`      | Read a key.                                                                                                            |
| `set`  | `(key, value, options?) => Promise<unknown>`    | Write a key. `options.EX` sets TTL in seconds.                                                                         |
| `del`  | `(key: string) => Promise<unknown>`             | Delete a key.                                                                                                          |
| `incr` | `(key: string) => Promise<number>` _(optional)_ | Atomically increment a key. Used by `RedisCacheStore.increment` for version bumps when the client exposes this method. |

---

## Prisma adapter

### `PrismaDelegate`

Import: `@edium/halifax`

Minimal structural type for a Prisma model delegate (e.g. `prisma.user`, `prisma.post`). Avoids a hard dependency on `@prisma/client`.

Key methods required: `findUnique`, `findFirst`, `findMany`, `count`, `create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`.

---

### `PrismaAdapterOptions`

Import: `@edium/halifax`

Options for the `PrismaAdapter` constructor.

| Property        | Type             | Default  | Description                                                                                                                                                                   |
| --------------- | ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delegate`      | `PrismaDelegate` | required | The Prisma model delegate (`prisma.post`, `prisma.user`, …).                                                                                                                  |
| `idField`       | `string`         | `'id'`   | Primary key field name.                                                                                                                                                       |
| `returnCreated` | `boolean`        | `false`  | When `true`, `createMany` falls back to serial `createOne` calls and returns the records. Slower but useful when the created data is needed.                                  |
| `model`         | `ModelSchema`    | —        | Prisma DMMF model. When provided, the adapter exposes a derived `fields` schema for type-safe introspection and OpenAPI generation. Auto-provided by `createPrismaResources`. |
| `scope`         | `TenantScope`    | —        | Tenant constraint. Set internally via `withScope` — do not pass directly.                                                                                                     |

---

### `CreatePrismaResourcesOptions`

Import: `@edium/halifax`

Global options for `createPrismaResources`.

| Property        | Type                                   | Description                                                                                                             |
| --------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `models`        | `Record<string, ModelResourceOptions>` | Per-model overrides keyed by Prisma model name (PascalCase).                                                            |
| `permissions`   | `CrudPermissions`                      | Default permissions applied to every generated resource.                                                                |
| `defaultLimit`  | `number`                               | Default page size for all generated resources.                                                                          |
| `maxLimit`      | `number`                               | Hard page-size cap for all generated resources.                                                                         |
| `idField`       | `string`                               | Primary key field name for all generated resources.                                                                     |
| `returnCreated` | `boolean`                              | When `true`, `createMany` returns created records on all generated resources.                                           |
| `tenantField`   | `string`                               | Column name for auto-tenant scoping. Resources that have a field with this name are automatically marked tenant-scoped. |

---

### `ModelResourceOptions`

Import: `@edium/halifax`

Per-model overrides within `CreatePrismaResourcesOptions.models`.

| Property              | Type                                    | Description                                        |
| --------------------- | --------------------------------------- | -------------------------------------------------- |
| `exclude`             | `boolean`                               | When `true`, this model is skipped entirely.       |
| `tenant`              | `TenantResourceConfig \| false`         | Override or disable tenant scoping for this model. |
| `routePrefix`         | `string`                                | Override the auto-derived URL prefix.              |
| `permissions`         | `CrudPermissions`                       | Override default CRUD permissions for this model.  |
| `requiredPermissions` | `Partial<Record<CrudAction, string[]>>` | Per-action permission requirements.                |
| `defaultLimit`        | `number`                                | Default page size override.                        |
| `maxLimit`            | `number`                                | Max page size override.                            |
| `maxFilterDepth`      | `number`                                | Maximum WHERE clause nesting depth.                |

---

### `ModelSchema`

Import: `@edium/halifax`

Minimal shape of a Prisma DMMF model — structurally compatible with `Prisma.DMMF.Model`. Used to derive the Halifax field schema from Prisma metadata.

| Property | Type             | Description                                                   |
| -------- | ---------------- | ------------------------------------------------------------- |
| `name`   | `string`         | Prisma model name (PascalCase).                               |
| `dbName` | `string \| null` | Underlying database table name. `null` to use the model name. |
| `fields` | `ModelField[]`   | Field definitions from the DMMF.                              |

---

### `ModelField`

Import: `@edium/halifax`

Minimal shape of a Prisma DMMF field — structurally compatible with `Prisma.DMMF.Field`.

| Property     | Type      | Description                                                                                                   |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------- |
| `name`       | `string`  | Column / property name.                                                                                       |
| `kind`       | `string`  | Prisma field kind: `'scalar'`, `'object'` (relation), `'enum'`, `'unsupported'`.                              |
| `isId`       | `boolean` | `true` when this field is the primary key.                                                                    |
| `isReadOnly` | `boolean` | `true` for Prisma-managed fields (relation FKs, read-only scalars).                                           |
| `hasDefault` | `boolean` | `true` when Prisma provides a default value.                                                                  |
| `type`       | `string`  | Prisma scalar type name (`'String'`, `'Int'`, `'Boolean'`, `'DateTime'`, …). Used for OpenAPI type inference. |

---

## Drizzle adapter (`@edium/halifax/drizzle`)

### `DrizzleAdapterConfig`

Import: `@edium/halifax/drizzle`

Constructor config for `DrizzleAdapter`.

| Property  | Type     | Description                                                                                                                                        |
| --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idField` | `string` | Primary key field name. Defaults to auto-detecting the first column with `.primaryKey()`. Set explicitly for composite keys or non-standard names. |

---

## Query AST

These interfaces are re-exported from `@edium/halifax-types`.

### `IQueryOptions`

Import: `@edium/halifax`

Full query AST sent to `POST /:resource/query`. Also accepted as the body by `updateMany` and `deleteMany`.

| Property   | Type             | Description                |
| ---------- | ---------------- | -------------------------- |
| `where`    | `IQueryFilter[]` | Filter conditions.         |
| `orderBy`  | `ISort[]`        | Sort clauses.              |
| `limit`    | `number`         | Maximum records to return. |
| `offset`   | `number`         | Records to skip.           |
| `fields`   | `string[]`       | Field projection.          |
| `distinct` | `string[]`       | Columns to deduplicate on. |

---

### `IQueryFilter`

Import: `@edium/halifax`

A single filter node in a `where` array.

| Property     | Type                           | Description                                                               |
| ------------ | ------------------------------ | ------------------------------------------------------------------------- |
| `field`      | `string`                       | Column to filter on.                                                      |
| `comparison` | `SqlComparison \| string`      | Comparison operator.                                                      |
| `value1`     | `QueryScalar \| QueryScalar[]` | Primary value for the comparison.                                         |
| `value2`     | `string \| number`             | Secondary value (used by `BETWEEN`).                                      |
| `operator`   | `SqlOperator`                  | Logical operator (`AND`/`OR`) joining this condition to the next sibling. |
| `children`   | `IQueryFilter[]`               | Nested sub-group of conditions for parenthesised AND/OR logic.            |

---

### `ISort`

Import: `@edium/halifax`

A single sort clause in an `orderBy` array.

| Property | Type       | Description                       |
| -------- | ---------- | --------------------------------- |
| `field`  | `string`   | Column to sort on.                |
| `order`  | `SqlOrder` | Sort direction (`ASC` or `DESC`). |

---

## Validation (`@edium/halifax`, contract in `@edium/halifax-types`)

See [README_VALIDATION.md](./README_VALIDATION.md) for usage.

### `ISchemaValidator<T>`

Import: `@edium/halifax` (or `@edium/halifax-types`)

Validator-agnostic schema adapter wrapping a Yup/Zod/Joi/Valibot (or any) schema. Drives both request validation and OpenAPI generation.

| Member          | Type                                                                     | Description                                                      |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `validate`      | `(data: unknown) => ValidationResult<T> \| Promise<ValidationResult<T>>` | Validate (and coerce) input; never throws for ordinary failures. |
| `toJsonSchema?` | `() => JsonSchema \| undefined`                                          | Best-effort JSON Schema for OpenAPI; optional.                   |

### `CustomEndpointSchemas`

Import: `@edium/halifax`

The `validate` option on a custom endpoint. Each part is an `ISchemaValidator` applied to that request part (validated + coerced before the handler; `422` with `details.fieldErrors` on failure).

| Property  | Type               | Description                     |
| --------- | ------------------ | ------------------------------- |
| `body?`   | `ISchemaValidator` | Validates/coerces `req.body`.   |
| `query?`  | `ISchemaValidator` | Validates/coerces `req.query`.  |
| `params?` | `ISchemaValidator` | Validates/coerces `req.params`. |

---

## Stored-procedure endpoints (`@edium/halifax`)

See [README_EXECUTE.md](./README_EXECUTE.md) for usage.

### `SqlExecutor`

Import: `@edium/halifax`

Backs stored-procedure endpoints. Implemented by `PrismaSqlExecutor` / `DrizzleSqlExecutor`.

| Member | Type                                                           | Description                                                                                      |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `call` | `(name: string, params: ExecuteValue[]) => Promise<unknown[]>` | Call a routine by name with positional, parameter-bound args; returns its rows (empty for void). |

### `ExecuteProcedure`

Import: `@edium/halifax`

One registered stored procedure — becomes its own `POST` route.

| Property                    | Type               | Description                                                                                                |
| --------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `name`                      | `string`           | **Required.** Database routine name used in the SQL call.                                                  |
| `params?`                   | `IExecuteParam[]`  | Ordered parameter declarations (order = positional binding).                                               |
| `roles?`                    | `string[] \| null` | Authorization for this procedure (`[]` = any authed; `null` = public). Defaults to `ExecuteOptions.roles`. |
| `path?`                     | `string`           | Route override: leading `/` = full path, else a segment under `basePath`. Defaults to kebab-cased `name`.  |
| `summary?` / `description?` | `string`           | OpenAPI metadata.                                                                                          |

### `IExecuteParam`

Import: `@edium/halifax` (or `@edium/halifax-types`)

| Property       | Type               | Description                                                              |
| -------------- | ------------------ | ------------------------------------------------------------------------ |
| `name`         | `string`           | Parameter name (request-body key + OpenAPI property).                    |
| `type?`        | `ExecuteParamType` | `'string'`/`'number'`/`'boolean'` (+ `[]` variants). Default `'string'`. |
| `required?`    | `boolean`          | Default `true`.                                                          |
| `description?` | `string`           | OpenAPI description.                                                     |

### `ExecuteOptions`

Import: `@edium/halifax`

The `execute` option on `CrudApiOptions`.

| Property     | Type                 | Description                             |
| ------------ | -------------------- | --------------------------------------- |
| `executor`   | `SqlExecutor`        | The executor that runs routines.        |
| `procedures` | `ExecuteProcedure[]` | Registered procedures — one route each. |
| `basePath?`  | `string`             | Route prefix. Default `'/execute'`.     |
| `roles?`     | `string[] \| null`   | Default authorization for every route.  |

### `PrismaRawClient` / `PrismaSqlExecutorOptions` / `DrizzleDb` / `DrizzleSqlExecutorOptions`

Import: `@edium/halifax` (Prisma) · `@edium/halifax/drizzle` (Drizzle)

Constructor inputs for the executors. `PrismaRawClient` is the `$queryRawUnsafe`/`$executeRawUnsafe` slice of a Prisma client; `DrizzleDb` is the `execute(sql)` slice of a Drizzle db. `PrismaSqlExecutorOptions` accepts `{ dialect?: 'postgres' | 'mysql' | 'mssql' }` (auto-detected from the active provider); `DrizzleSqlExecutorOptions` accepts `{ dialect?: DrizzleSqlDialect }` = `'postgres' | 'mysql'` (Drizzle has no SQL Server driver; defaults to `postgres`).
