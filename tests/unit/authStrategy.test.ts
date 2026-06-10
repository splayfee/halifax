import { describe, expect, it } from 'vitest'
import {
  AllowAllAuthStrategy,
  ApiKeyAuthStrategy,
  JwtClaimsAuthStrategy,
  PassportAuthStrategy,
  PassportJwtStrategy,
  PassportSessionStrategy
} from '@/auth/AuthStrategy.js'
import type { HttpRequest } from '@/core/http.js'

function req(headers: Record<string, string> = {}, method = 'GET', raw: unknown = null): HttpRequest {
  return { method, params: {}, query: {}, body: null, headers, raw }
}

// Minimal ResourceDefinition stub for authorize() calls
const resource = { name: 'R', routePrefix: 'r', fields: [], permissions: {} } as any

describe('AllowAllAuthStrategy', () => {
  it('authenticates every request without inspection', () => {
    const ctx = (new AllowAllAuthStrategy() as any).authenticate(req())
    expect(ctx.isAuthenticated).toBe(true)
  })
})

describe('ApiKeyAuthStrategy', () => {
  const strategy = new ApiKeyAuthStrategy('s3cret')

  it('accepts the correct key', () => {
    const ctx = strategy.authenticate(req({ 'x-api-key': 's3cret' }))
    expect(ctx.isAuthenticated).toBe(true)
  })

  it('rejects a wrong key with an AuthError (403)', () => {
    expect(() => strategy.authenticate(req({ 'x-api-key': 'wrong' }))).toThrow(
      expect.objectContaining({ status: 403 })
    )
  })

  it('rejects a missing key with an AuthError (403)', () => {
    expect(() => strategy.authenticate(req({}))).toThrow(expect.objectContaining({ status: 403 }))
  })

  it('respects a custom header name', () => {
    const custom = new ApiKeyAuthStrategy('key', 'x-token')
    const ctx = custom.authenticate(req({ 'x-token': 'key' }))
    expect(ctx.isAuthenticated).toBe(true)
  })
})

describe('JwtClaimsAuthStrategy', () => {
  const strategy = new JwtClaimsAuthStrategy((token) => ({
    isAuthenticated: true,
    userId: token,
    permissions: ['read'],
    roles: []
  }))

  it('extracts the Bearer token and calls verifyToken', async () => {
    const ctx = await strategy.authenticate(req({ authorization: 'Bearer my-token' }))
    expect(ctx.isAuthenticated).toBe(true)
    expect(ctx.userId).toBe('my-token')
  })

  it('is case-insensitive on Bearer scheme', async () => {
    const ctx = await strategy.authenticate(req({ authorization: 'bearer my-token' }))
    expect(ctx.userId).toBe('my-token')
  })

  it('rejects a missing Authorization header with 401', async () => {
    await expect(strategy.authenticate(req({}))).rejects.toMatchObject({ status: 401 })
  })

  it('rejects a non-Bearer scheme with 401', async () => {
    await expect(
      strategy.authenticate(req({ authorization: 'Basic dXNlcjpwYXNz' }))
    ).rejects.toMatchObject({ status: 401 })
  })

  describe('authorize', () => {
    it('allows when there are no required permissions', () => {
      expect(
        strategy.authorize({
          auth: { isAuthenticated: true, permissions: [], roles: [] },
          action: 'readMany',
          resource,
          requiredPermissions: [],
          req: req()
        })
      ).toBe(true)
    })

    it('allows when the user has the required permission', () => {
      expect(
        strategy.authorize({
          auth: { isAuthenticated: true, permissions: ['posts.write'], roles: [] },
          action: 'create',
          resource,
          requiredPermissions: ['posts.write'],
          req: req()
        })
      ).toBe(true)
    })

    it('allows when the user has the required role', () => {
      expect(
        strategy.authorize({
          auth: { isAuthenticated: true, permissions: [], roles: ['admin'] },
          action: 'create',
          resource,
          requiredPermissions: ['admin'],
          req: req()
        })
      ).toBe(true)
    })

    it('rejects when the user lacks both the permission and role', () => {
      expect(
        strategy.authorize({
          auth: { isAuthenticated: true, permissions: [], roles: [] },
          action: 'create',
          resource,
          requiredPermissions: ['posts.write'],
          req: req()
        })
      ).toBe(false)
    })
  })
})

describe('PassportAuthStrategy', () => {
  it('delegates to the supplied authenticateWithPassport function', async () => {
    const strategy = new PassportAuthStrategy(async () => ({ isAuthenticated: true, userId: 'u1' }))
    const ctx = await strategy.authenticate(req())
    expect(ctx.isAuthenticated).toBe(true)
    expect(ctx.userId).toBe('u1')
  })

  it('propagates errors thrown by the callback', async () => {
    const strategy = new PassportAuthStrategy(async () => {
      throw new Error('passport error')
    })
    await expect(strategy.authenticate(req())).rejects.toThrow('passport error')
  })
})

describe('PassportJwtStrategy', () => {
  function makePassport(user: unknown, err: unknown = null) {
    return {
      authenticate:
        (_strategy: string, _opts: unknown, cb: (err: unknown, user: unknown) => void) => () =>
          cb(err, user)
    }
  }

  it('resolves with the mapped user on success', async () => {
    const passport = makePassport({ sub: 'user-42', permissions: ['read'], roles: ['admin'] })
    const strategy = new PassportJwtStrategy({ passport })
    const ctx = await strategy.authenticate(req())
    expect(ctx.isAuthenticated).toBe(true)
    expect(ctx.userId).toBe('user-42')
    expect(ctx.permissions).toContain('read')
    expect(ctx.roles).toContain('admin')
  })

  it('rejects with AuthenticationError when user is falsy', async () => {
    const passport = makePassport(null)
    const strategy = new PassportJwtStrategy({ passport })
    await expect(strategy.authenticate(req())).rejects.toMatchObject({ status: 401 })
  })

  it('rejects with the original Error when err is an Error instance', async () => {
    const passport = makePassport(null, new Error('Token expired'))
    const strategy = new PassportJwtStrategy({ passport })
    await expect(strategy.authenticate(req())).rejects.toThrow('Token expired')
  })

  it('rejects with AuthenticationError when err is a plain string', async () => {
    const passport = makePassport(null, 'bad token')
    const strategy = new PassportJwtStrategy({ passport })
    await expect(strategy.authenticate(req())).rejects.toMatchObject({ status: 401 })
  })

  it('uses a custom mapUser function', async () => {
    const passport = makePassport({ someField: 'custom' })
    const strategy = new PassportJwtStrategy({
      passport,
      mapUser: () => ({ isAuthenticated: true, userId: 'mapped' })
    })
    const ctx = await strategy.authenticate(req())
    expect(ctx.userId).toBe('mapped')
  })

  describe('authorize', () => {
    const strategy = new PassportJwtStrategy({ passport: makePassport({}) })

    it('allows when there are no required permissions', () => {
      expect(
        strategy.authorize({
          auth: { isAuthenticated: true },
          action: 'readMany',
          resource,
          requiredPermissions: [],
          req: req()
        })
      ).toBe(true)
    })

    it('allows when the user has the required permission', () => {
      expect(
        strategy.authorize({
          auth: { isAuthenticated: true, permissions: ['posts.read'] },
          action: 'readMany',
          resource,
          requiredPermissions: ['posts.read'],
          req: req()
        })
      ).toBe(true)
    })

    it('rejects when the user lacks the permission', () => {
      expect(
        strategy.authorize({
          auth: { isAuthenticated: true, permissions: [] },
          action: 'readMany',
          resource,
          requiredPermissions: ['posts.read'],
          req: req()
        })
      ).toBe(false)
    })
  })
})

describe('PassportSessionStrategy', () => {
  it('reads req.raw.user populated by Passport session middleware', () => {
    const sessionUser = { id: 'u1', roles: ['editor'], permissions: ['posts.write'] }
    const strategy = new PassportSessionStrategy()
    const ctx = strategy.authenticate(req({}, 'GET', { user: sessionUser }))
    expect(ctx.isAuthenticated).toBe(true)
    expect(ctx.userId).toBe('u1')
    expect(ctx.roles).toContain('editor')
    expect(ctx.permissions).toContain('posts.write')
  })

  it('reads sub as userId when id is absent', () => {
    const strategy = new PassportSessionStrategy()
    const ctx = strategy.authenticate(req({}, 'GET', { user: { sub: 'sub-42' } }))
    expect(ctx.userId).toBe('sub-42')
  })

  it('throws 401 when req.raw.user is absent (unauthenticated)', () => {
    const strategy = new PassportSessionStrategy()
    expect(() => strategy.authenticate(req({}, 'GET', {}))).toThrow(
      expect.objectContaining({ status: 401 })
    )
  })

  it('throws 401 when raw is null (no session middleware)', () => {
    const strategy = new PassportSessionStrategy()
    expect(() => strategy.authenticate(req())).toThrow(expect.objectContaining({ status: 401 }))
  })

  it('uses a custom mapUser function', () => {
    const strategy = new PassportSessionStrategy((user: any) => ({
      isAuthenticated: true,
      userId: user.username,
      roles: user.groups
    }))
    const ctx = strategy.authenticate(
      req({}, 'GET', { user: { username: 'dave', groups: ['admin'] } })
    )
    expect(ctx.userId).toBe('dave')
    expect(ctx.roles).toContain('admin')
  })

  describe('authorize', () => {
    const strategy = new PassportSessionStrategy()

    it('allows when there are no required permissions', () => {
      expect(
        strategy.authorize({
          auth: { isAuthenticated: true, permissions: [], roles: [] },
          action: 'readMany',
          resource,
          requiredPermissions: [],
          req: req()
        })
      ).toBe(true)
    })

    it('allows when the user has a matching role', () => {
      expect(
        strategy.authorize({
          auth: { isAuthenticated: true, permissions: [], roles: ['admin'] },
          action: 'deleteOne',
          resource,
          requiredPermissions: ['admin'],
          req: req()
        })
      ).toBe(true)
    })

    it('rejects when the user lacks the required permission or role', () => {
      expect(
        strategy.authorize({
          auth: { isAuthenticated: true, permissions: [], roles: [] },
          action: 'deleteOne',
          resource,
          requiredPermissions: ['admin'],
          req: req()
        })
      ).toBe(false)
    })
  })
})
