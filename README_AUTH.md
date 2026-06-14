# Authentication

Halifax auth is handled by an `AuthStrategy` injected at router creation time. The interface is:

```ts
interface AuthStrategy {
  authenticate(req: HttpRequest): AuthContext | Promise<AuthContext>
  authorize?(params: AuthorizeParams): boolean | Promise<boolean>
}
```

`authenticate` runs on every request and returns an `AuthContext`. `authorize` is optional — when present it gates each action against the context. When absent, Halifax falls back to checking `requiredPermissions` directly against `auth.roles` and `auth.permissions`.

## Built-in Strategies

### `AllowAllAuthStrategy`

No authentication — every request is admitted. For local development only.

```ts
import { AllowAllAuthStrategy } from '@edium/halifax'

createExpressCrudRouter([resource], { authStrategy: new AllowAllAuthStrategy() })
```

### `ApiKeyAuthStrategy`

Reads a header and compares it to a shared secret.

```ts
import { ApiKeyAuthStrategy } from '@edium/halifax'

// Default header: x-api-key
const authStrategy = new ApiKeyAuthStrategy(process.env.API_KEY ?? '')

// Custom header name
const authStrategy = new ApiKeyAuthStrategy(process.env.API_KEY ?? '', 'x-token')
```

Wrong or missing key → 403.

### `JwtClaimsAuthStrategy`

Extracts a Bearer token from `Authorization` and calls your verify callback. No Passport dependency.

```ts
import { JwtClaimsAuthStrategy } from '@edium/halifax'
import { verify } from 'jsonwebtoken'

export const authStrategy = new JwtClaimsAuthStrategy(async (token) => {
  const payload = verify(token, process.env.JWT_SECRET!) as Record<string, unknown>
  return {
    isAuthenticated: true,
    userId: payload.sub as string,
    roles: (payload.roles ?? []) as string[],
    permissions: (payload.permissions ?? []) as string[],
    claims: payload
  }
})
```

Missing or non-Bearer `Authorization` header → 401. A verify callback that throws → 401.

### `PassportSessionStrategy`

Drop-in for apps that use Passport with session cookies (as opposed to JWT Bearer tokens). Passport's session middleware runs at the Express app level before Halifax, so `req.user` is already populated by the time Halifax sees the request. This strategy just reads it.

**Prerequisites in your Express app (before mounting Halifax):**

```ts
import session from 'express-session'
import passport from 'passport'

app.use(session({ secret: process.env.SESSION_SECRET!, resave: false, saveUninitialized: false }))
app.use(passport.initialize())
app.use(passport.session())
```

**Usage:**

```ts
import { PassportSessionStrategy } from '@edium/halifax'

// Default: reads id/sub → userId, roles, permissions from req.user
export const authStrategy = new PassportSessionStrategy()

// Custom mapping for non-standard user shapes
export const authStrategy = new PassportSessionStrategy((user) => {
  const u = user as { username: string; groups: string[] }
  return { isAuthenticated: true, userId: u.username, roles: u.groups }
})
```

No passport instance is passed — Halifax never calls `passport.authenticate()`. If `req.user` is absent (session expired, not logged in), the request is rejected with 401.

### `PassportJwtStrategy`

Drop-in for an existing Passport + `passport-jwt` setup.

```ts
import passport from 'passport'
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt'
import { PassportJwtStrategy } from '@edium/halifax'

passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET
    },
    (payload, done) => done(null, payload)
  )
)

// Default: reads sub/id → userId, roles, permissions, full payload → claims
export const authStrategy = new PassportJwtStrategy({ passport })

// Custom payload mapping
export const authStrategy = new PassportJwtStrategy({
  passport,
  mapUser: (user) => {
    const u = user as { userId: string; role: string }
    return { isAuthenticated: true, userId: u.userId, roles: [u.role] }
  }
})
```

## Per-Field Role-Based Access Control

`FieldDefinition` supports two optional arrays for column-level visibility:

```ts
const postResource: ResourceDefinition = {
  routePrefix: 'posts',
  repository: new PrismaAdapter({ delegate: prisma.post }),
  fields: [
    { name: 'id' },
    { name: 'title' },
    { name: 'content' },
    // Only users with role 'editor' or 'admin' can read or write the `status` field.
    { name: 'status',     readRoles: ['editor', 'admin'], writeRoles: ['editor', 'admin'] },
    // Any authenticated user can read `authorId`, but only admins can set it.
    { name: 'authorId',   writeRoles: ['admin'] },
    // `internalNote` is invisible to everyone except admins.
    { name: 'internalNote', readRoles: ['admin'], writeRoles: ['admin'] },
  ]
}
```

### `readRoles`

When a field has `readRoles`, it is **stripped from every response** for any caller whose `auth.roles` and `auth.permissions` contain none of the listed values. This applies uniformly across `getOne`, `getMany`, `query`, and the records returned by `createOne`, `updateOne`, and `upsertOne` — no extra configuration per operation. The field is never sent to the database `SELECT`; it is removed at the response boundary after the auth context is resolved.

### `writeRoles`

When a field has `writeRoles`, callers without a matching role have the field **silently dropped** from write bodies before the repository sees them. The effect is identical to `writable: false` for that caller. Callers with a matching role can write the field normally.

### Role matching

Both `readRoles` and `writeRoles` are matched against both `auth.roles` and `auth.permissions` — a caller needs at least one match in either array. This is consistent with how `requiredPermissions` works.

### Primary key note

The primary key is protected by `writable: false` by default regardless of `writeRoles`. Setting `writeRoles` on the primary key has no additional effect.

## Per-Action Permission Requirements

`requiredPermissions` on a resource maps each CRUD action to a list of roles or permission strings. The authenticated user must possess at least one entry from the list (matched against both `auth.roles` and `auth.permissions`).

```ts
const postResource: ResourceDefinition = {
  ...
  requiredPermissions: {
    readMany:  ['posts.read'],
    readOne:   ['posts.read'],
    create:    ['posts.create'],
    updateOne: ['posts.update'],
    deleteOne: ['posts.delete'],
  }
}
```

Actions not listed in `requiredPermissions` are allowed for any authenticated user. If `authorize` is implemented on the strategy, it overrides this fallback entirely.

## Custom `authorize` Logic

Implement `authorize` on your strategy for full control:

```ts
class RoleBasedStrategy implements AuthStrategy {
  authenticate(req) {
    /* ... verify token ... */
  }

  authorize({ auth, action, resource, requiredPermissions }) {
    if (auth.roles.includes('admin')) return true
    return requiredPermissions.every((p) => auth.permissions.includes(p) || auth.roles.includes(p))
  }
}
```

## Environment Variables

```bash
API_KEY="your-api-key"
# or
JWT_SECRET="your-secret-key"
# or
SESSION_SECRET="your-secret-key"
```
