# Classes — `@edium/halifax`

All publicly exported TypeScript classes. Type aliases are in [README_TYPES.md](./README_TYPES.md); interfaces are in [README_INTERFACES.md](./README_INTERFACES.md).

---

## Auth strategies

All auth strategy classes implement `AuthStrategy`. Pass an instance to `CrudApiOptions.authStrategy`.

### `AllowAllAuthStrategy`

Import: `@edium/halifax`

Passes every request through without any authentication check. Returns `{ isAuthenticated: true }` for every caller. Suitable for public APIs or local development only.

```ts
import { AllowAllAuthStrategy } from '@edium/halifax'
createExpressCrudRouter(resources, { authStrategy: new AllowAllAuthStrategy() })
```

---

### `ApiKeyAuthStrategy`

Import: `@edium/halifax`

Reads a request header and compares it against a static shared secret.

```ts
new ApiKeyAuthStrategy(expectedApiKey: string, headerName?: string)
```

| Parameter | Default | Description |
|---|---|---|
| `expectedApiKey` | required | The secret key callers must supply. |
| `headerName` | `'x-api-key'` | Header to read the key from. |

- Missing header → 401 Unauthorized
- Wrong key → 403 Forbidden
- OpenAPI: documents `apiKey` in header (uses the configured `headerName`).

---

### `JwtClaimsAuthStrategy`

Import: `@edium/halifax`

Extracts a Bearer token from the `Authorization` header and passes it to your verify callback. No Passport dependency — use this for any JWT library (`jsonwebtoken`, `jose`, etc.).

```ts
new JwtClaimsAuthStrategy(
  verifyToken: (token: string, req: HttpRequest) => AuthContext | Promise<AuthContext>
)
```

The verify callback receives the raw token string and must return an `AuthContext`. Throw any error to reject (→ 401). The built-in `authorize` checks `requiredPermissions` against `auth.roles` and `auth.permissions`.

OpenAPI: documents `http` bearer JWT.

---

### `PassportJwtStrategy`

Import: `@edium/halifax`

Delegates JWT verification to a Passport strategy already registered on your Passport instance. Use when you have an existing `passport-jwt` setup.

```ts
new PassportJwtStrategy(options: PassportJwtStrategyOptions)
```

See `PassportJwtStrategyOptions` in [README_INTERFACES.md](./README_INTERFACES.md). The built-in `authorize` checks `requiredPermissions` against `auth.roles` and `auth.permissions`.

OpenAPI: documents `http` bearer JWT.

---

### `PassportSessionStrategy`

Import: `@edium/halifax`

Authenticates using Passport session cookies. Reads `req.raw.user` (populated by Passport's session middleware running before Halifax).

```ts
new PassportSessionStrategy(mapUser?: (user: unknown) => AuthContext)
```

| Parameter | Description |
|---|---|
| `mapUser` | Optional function to map the raw session user object to an `AuthContext`. Default reads `sub`/`id`, `roles`, and `permissions`. |

**Prerequisites** — add before mounting Halifax:
```ts
app.use(session({ secret: '...' }))
app.use(passport.initialize())
app.use(passport.session())
```

Missing `req.user` (session expired or not logged in) → 401.

OpenAPI: documents `apiKey` in cookie (`connect.sid`).

---

### `PassportAuthStrategy`

Import: `@edium/halifax`

Generic Passport wrapper. Takes a function that calls your Passport strategy and returns an `AuthContext`. Use when neither `PassportJwtStrategy` nor `PassportSessionStrategy` fits.

```ts
new PassportAuthStrategy(
  authenticateWithPassport: (req: HttpRequest) => AuthContext | Promise<AuthContext>
)
```

---

### `Auth0JwtStrategy`

Import: `@edium/halifax`

Alias of `JwtClaimsAuthStrategy`. Identical in every way — the name signals intent when your tokens come from Auth0.

```ts
new Auth0JwtStrategy(verifyToken)
```

---

### `FirebaseJwtStrategy`

Import: `@edium/halifax`

Alias of `JwtClaimsAuthStrategy`. Identical in every way — the name signals intent when your tokens are Firebase ID tokens.

```ts
new FirebaseJwtStrategy(verifyToken)
```

---

## HTTP server adapters

Each adapter wraps a framework app instance and implements `HttpServer`. Pass to `registerCrudApi`, or use the corresponding `create*CrudRouter` / `create*CrudPlugin` helper instead.

### `ExpressHttpServer`

Import: `@edium/halifax`

Wraps an Express (4 or 5) `Application` or `Router`. Used internally by `createExpressCrudRouter`.

```ts
new ExpressHttpServer(app: ExpressAppLike)
```

---

### `FastifyHttpServer`

Import: `@edium/halifax`

Wraps a Fastify instance. Used internally by `createFastifyCrudPlugin`.

```ts
new FastifyHttpServer(app: FastifyAppLike)
```

---

### `HyperExpressHttpServer`

Import: `@edium/halifax`

Wraps a HyperExpress `Server` instance. Used internally by `createHyperExpressCrudRouter`.

```ts
new HyperExpressHttpServer(app: HyperExpressAppLike)
```

---

### `UltimateExpressHttpServer`

Import: `@edium/halifax`

Wraps an Ultimate Express `App` instance. Used internally by `createUltimateExpressCrudRouter`.

```ts
new UltimateExpressHttpServer(app: UltimateExpressAppLike)
```

---

## Repository adapters

### `PrismaAdapter<TRecord, TCreate, TUpdate>`

Import: `@edium/halifax`

Implements the full `Repository` interface against any Prisma-supported database. Supports all nine CRUD operations, the query-builder endpoint, multi-tenant scoping (`withScope`), and relation eager-loading (`?include=`). Field schema and OpenAPI types are auto-derived from the Prisma DMMF when a `model` is provided.

```ts
new PrismaAdapter<TRecord, TCreate, TUpdate>(options: PrismaAdapterOptions)
```

See `PrismaAdapterOptions` in [README_INTERFACES.md](./README_INTERFACES.md).

**Static method:** `PrismaAdapter` has no static methods. For auto-generating resources from all Prisma models, use `createPrismaResources` (a standalone function).

**Capabilities reported:**
- `supportsIncludes: true`
- `supportsCreateManyReturn: <returnCreated option>`

---

### `DrizzleAdapter<TRecord, TCreate, TUpdate>`

Import: `@edium/halifax/drizzle`

Implements the full `Repository` interface against any Drizzle-compatible database (PostgreSQL, MySQL, SQLite, LibSQL). Field schema and OpenAPI types are auto-derived from the Drizzle table definition via `getTableColumns()`. Supports the query-builder endpoint (`executeQuery`), multi-tenant scoping (`withScope`), and field projection. `drizzle-orm` is a required peer dependency when this adapter is used.

```ts
import { DrizzleAdapter } from '@edium/halifax/drizzle'

new DrizzleAdapter<TRecord, TCreate, TUpdate>(
  db: AnyDrizzleDB,
  table: Table,
  config?: DrizzleAdapterConfig,
  scope?: TenantScope | null
)
```

See `DrizzleAdapterConfig` in [README_INTERFACES.md](./README_INTERFACES.md).

**Static method:**

```ts
DrizzleAdapter.fieldsFromTable(table: Table, idField?: string): FieldDefinition[]
```

Derives a Halifax field schema from a Drizzle table without constructing a full adapter instance. Useful for inspecting or overriding the derived fields before passing them to a `ResourceDefinition`.

---

## Cache stores

Both implement `CacheStore`. Pass to `CrudApiOptions.cache.store`.

### `InMemoryCacheStore`

Import: `@edium/halifax`

Process-local in-memory cache. The default when no `store` is configured. Simple and zero-dependency, but does not persist across restarts and is not shared across processes or instances.

```ts
new InMemoryCacheStore()
```

---

### `RedisCacheStore`

Import: `@edium/halifax`

Redis-backed distributed cache store. Accepts any Redis client satisfying `RedisLikeClient` — `redis` v4 works directly.

```ts
new RedisCacheStore(client: RedisLikeClient)
```

```ts
import { createClient } from 'redis'
import { RedisCacheStore } from '@edium/halifax'

const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

createExpressCrudRouter(resources, {
  cache: { store: new RedisCacheStore(redis), ttlSeconds: 60 }
})
```

---

## Error classes

All error classes extend `HttpError`. Throw these inside a custom `AuthStrategy` or `Repository` to return the corresponding HTTP status with a structured `{ errors: [...] }` body. Halifax catches `HttpError` subclasses at the route boundary and serializes them automatically.

### `HttpError` (abstract)

Import: `@edium/halifax`

Base class for all Halifax HTTP errors. Not instantiated directly.

| Property | Type | Description |
|---|---|---|
| `status` | `number` | HTTP status code. |
| `message` | `string` | Human-readable error message. |
| `details` | `unknown` | Optional structured details included in the error body. |

---

### Error subclasses

| Class | Status | When to throw |
|---|---|---|
| `AuthenticationError` | 401 | Missing or invalid credentials. Throw from `AuthStrategy.authenticate`. |
| `AuthorizationError` | 403 | Valid credentials but insufficient permissions. Throw from `AuthStrategy.authenticate` or `authorize`. |
| `BadRequestError` | 400 | Malformed input — invalid ID format, bad query params, bad body structure. |
| `NotFoundError` | 404 | Record with the given ID does not exist. Throw from a custom `Repository.getOne`. |
| `MethodNotAllowedError` | 405 | HTTP method not enabled for this resource. Used internally by Halifax. |
| `NotAcceptableError` | 406 | Client `Accept` header excludes `application/json`. Used internally by Halifax. |
| `UnsupportedMediaTypeError` | 415 | Body-carrying request with non-JSON `Content-Type`. Used internally by Halifax. |
| `UnprocessableEntityError` | 422 | Unknown fields in body, missing required filter, empty update payload. |
| `NotImplementedError` | 501 | Repository does not support this operation (e.g. `upsertOne` not implemented). |
| `ServerError` | 500 | Unexpected internal error. Halifax uses this as a catch-all; throw it from a custom adapter for explicit 500s. |

All constructors accept `(message: string, details?: unknown)`.
