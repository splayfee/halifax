import { describe, expect, it } from 'vitest'
import {
  AllowAllAuthStrategy,
  ApiKeyAuthStrategy,
  JwtClaimsAuthStrategy,
} from '@/auth/AuthStrategy.js'
import type { HttpRequest } from '@/core/http.js'

function req(headers: Record<string, string> = {}): HttpRequest {
  return { params: {}, query: {}, body: null, headers, raw: null }
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
    expect(() => strategy.authenticate(req({}))).toThrow(
      expect.objectContaining({ status: 403 })
    )
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
    roles: [],
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
          req: req(),
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
          req: req(),
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
          req: req(),
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
          req: req(),
        })
      ).toBe(false)
    })
  })
})
