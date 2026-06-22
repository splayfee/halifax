import { describe, it, expect, vi } from 'vitest'
import { CompositeAuthStrategy } from '@/auth/strategies/CompositeAuthStrategy.js'
import { AuthenticationError } from '@/errors/AuthenticationError.js'
import type { AuthContext, AuthStrategy } from '@/auth/strategies/types.js'
import type { HttpRequest } from '@/core/types.js'

function makeReq(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return { method: 'GET', params: {}, query: {}, body: {}, headers: {}, raw: {}, ...overrides }
}

describe('CompositeAuthStrategy — construction', () => {
  it('throws when constructed with no strategies', () => {
    expect(() => new CompositeAuthStrategy([])).toThrow(/at least one/)
  })
})

describe('CompositeAuthStrategy — authenticate', () => {
  it('returns the context from the first strategy that authenticates', async () => {
    const second = {
      authenticate: vi.fn().mockResolvedValue({ isAuthenticated: true, userId: 'b' })
    }
    const first: AuthStrategy = {
      authenticate: vi.fn(() => {
        throw new AuthenticationError('no key')
      })
    }
    const composite = new CompositeAuthStrategy([first, second])

    const auth = await composite.authenticate(makeReq())
    expect(auth).toMatchObject({ isAuthenticated: true, userId: 'b' })
    expect(first.authenticate).toHaveBeenCalled()
    expect(second.authenticate).toHaveBeenCalled()
  })

  it('short-circuits on the first success without trying later strategies', async () => {
    const first = {
      authenticate: vi.fn().mockResolvedValue({ isAuthenticated: true, userId: 'a' })
    }
    const second = {
      authenticate: vi.fn().mockResolvedValue({ isAuthenticated: true, userId: 'b' })
    }
    const composite = new CompositeAuthStrategy([first, second])

    const auth = await composite.authenticate(makeReq())
    expect(auth).toMatchObject({ userId: 'a' })
    expect(second.authenticate).not.toHaveBeenCalled()
  })

  it('throws the last error when no strategy authenticates', async () => {
    const first: AuthStrategy = {
      authenticate: () => {
        throw new AuthenticationError('first failed')
      }
    }
    const second: AuthStrategy = {
      authenticate: () => {
        throw new AuthenticationError('second failed')
      }
    }
    const composite = new CompositeAuthStrategy([first, second])
    await expect(composite.authenticate(makeReq())).rejects.toThrow('second failed')
  })
})

describe('CompositeAuthStrategy — authorization delegation', () => {
  async function authorizeVia(winner: AuthStrategy) {
    const composite = new CompositeAuthStrategy([winner])
    const auth = await composite.authenticate(makeReq())
    return { composite, auth }
  }

  it('delegates authorize to the winning strategy', async () => {
    const authorize = vi.fn().mockReturnValue(false)
    const winner: AuthStrategy = {
      authenticate: () => ({ isAuthenticated: true }) as AuthContext,
      authorize
    }
    const { composite, auth } = await authorizeVia(winner)
    const allowed = await composite.authorize({
      auth,
      action: 'readMany',
      resource: { routePrefix: 'x', repository: {} as never },
      requiredPermissions: ['admin'],
      req: makeReq()
    })
    expect(allowed).toBe(false)
    expect(authorize).toHaveBeenCalled()
  })

  it('falls back to a flat permission match when the winner has no authorize', async () => {
    const winner: AuthStrategy = {
      authenticate: () => ({ isAuthenticated: true, roles: ['admin'] }) as AuthContext
    }
    const { composite, auth } = await authorizeVia(winner)
    const allowed = await composite.authorize({
      auth,
      action: 'readMany',
      resource: { routePrefix: 'x', repository: {} as never },
      requiredPermissions: ['admin'],
      req: makeReq()
    })
    expect(allowed).toBe(true)
  })

  it('delegates authorizeCustom to the winning strategy', async () => {
    const authorizeCustom = vi.fn().mockReturnValue(true)
    const winner: AuthStrategy = {
      authenticate: () => ({ isAuthenticated: true }) as AuthContext,
      authorizeCustom
    }
    const composite = new CompositeAuthStrategy([winner])
    const auth = await composite.authenticate(makeReq())
    const allowed = await composite.authorizeCustom({
      auth,
      method: 'POST',
      path: '/x',
      requiredPermissions: ['role:2'],
      req: makeReq()
    })
    expect(allowed).toBe(true)
    expect(authorizeCustom).toHaveBeenCalled()
  })

  it('falls back to a flat match for authorizeCustom when the winner lacks it', async () => {
    const winner: AuthStrategy = {
      authenticate: () => ({ isAuthenticated: true, permissions: ['devices:read'] }) as AuthContext
    }
    const composite = new CompositeAuthStrategy([winner])
    const auth = await composite.authenticate(makeReq())
    const allowed = await composite.authorizeCustom({
      auth,
      method: 'GET',
      path: '/devices',
      requiredPermissions: ['devices:read'],
      req: makeReq()
    })
    expect(allowed).toBe(true)
  })
})

describe('CompositeAuthStrategy — openApiScheme', () => {
  it('returns the first declared security scheme', () => {
    const first: AuthStrategy = { authenticate: () => ({ isAuthenticated: true }) }
    const second: AuthStrategy = {
      authenticate: () => ({ isAuthenticated: true }),
      openApiScheme: () => ({ type: 'apiKey', in: 'header', name: 'x-api-key' })
    }
    const composite = new CompositeAuthStrategy([first, second])
    expect(composite.openApiScheme()).toEqual({ type: 'apiKey', in: 'header', name: 'x-api-key' })
  })

  it('returns undefined when no member declares a scheme', () => {
    const composite = new CompositeAuthStrategy([
      { authenticate: () => ({ isAuthenticated: true }) }
    ])
    expect(composite.openApiScheme()).toBeUndefined()
  })
})
