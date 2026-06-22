/**
 * Integration tests for the 2.7 custom-endpoint capabilities, exercised end-to-end over a real
 * Express server with supertest: public (unauthenticated) endpoints, per-endpoint content
 * negotiation (`consumes`/`produces`), hierarchical authorization via `AuthStrategy.authorizeCustom`,
 * the per-endpoint `authorize` predicate, and `CompositeAuthStrategy` (multiple credentials).
 *
 * These features are transport/auth concerns and need no database, so this suite runs unconditionally
 * (unlike the GROUP BY + HAVING suite, which is DB-gated).
 *
 * Run with: pnpm test:integration
 */

import express, { Router } from 'express'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ApiKeyAuthStrategy,
  CompositeAuthStrategy,
  type AuthStrategy
} from '@/auth/AuthStrategy.js'
import { ExpressHttpServer } from '@/adapters/http/ExpressAdapter.js'
import { registerCrudApi } from '@/core/crudRouter.js'
import { AuthenticationError } from '@/errors/AuthenticationError.js'

const API_KEY = 'composite-key'

/** Mounts a fresh Express app with JSON + text body parsing and a Halifax router. */
function makeApp(authStrategy?: AuthStrategy): {
  app: ReturnType<typeof express>
  api: ReturnType<typeof registerCrudApi>
} {
  const app = express()
  app.use(express.json())
  app.use(express.text({ type: ['text/csv', 'text/plain'] }))
  const router = Router()
  const api = registerCrudApi(
    new ExpressHttpServer(router),
    [],
    authStrategy ? { authStrategy } : {}
  )
  app.use(router)
  return { app, api }
}

// ─── Public (unauthenticated) endpoints ─────────────────────────────────────────

describe('custom endpoints — public (auth skipped)', () => {
  let app: ReturnType<typeof express>

  beforeAll(() => {
    // A strategy that always rejects — proves a public endpoint never calls authenticate.
    const denyAll: AuthStrategy = {
      authenticate() {
        throw new AuthenticationError('should never be called for a public endpoint')
      }
    }
    const built = makeApp(denyAll)
    app = built.app
    built.api
      .addCustomEndpoint('GET', '/health', null, async (_req, res) => {
        await res.status(200).json({ status: 'ok' })
      })
      .addCustomEndpoint('POST', '/webhooks/ingest', { auth: false }, async (req, res) => {
        await res.status(202).json({ received: (req.body as { event?: string }).event ?? null })
      })
  })

  it('serves a null-roles endpoint with no credentials', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('serves an { auth: false } endpoint and still parses the JSON body', async () => {
    const res = await request(app).post('/webhooks/ingest').send({ event: 'ping' })
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ received: 'ping' })
  })
})

// ─── Content negotiation: consumes / produces ───────────────────────────────────

describe('custom endpoints — content negotiation', () => {
  let app: ReturnType<typeof express>

  beforeAll(() => {
    const built = makeApp(new ApiKeyAuthStrategy(API_KEY))
    app = built.app
    built.api
      .addCustomEndpoint(
        'POST',
        '/imports/csv',
        { roles: [], consumes: ['text/csv'] },
        async (req, res) => {
          const rows = String(req.body ?? '')
            .trim()
            .split('\n').length
          await res.status(200).json({ rows })
        }
      )
      .addCustomEndpoint(
        'GET',
        '/reports/export.pdf',
        { roles: [], produces: ['application/pdf'] },
        async (_req, res) => {
          res.setHeader?.('Content-Type', 'application/pdf')
          ;(res.raw as { end(chunk: Buffer): void }).end(
            Buffer.from('%PDF-1.4\n%generated', 'utf8')
          )
        }
      )
  })

  it('accepts a declared non-JSON request body (text/csv)', async () => {
    const res = await request(app)
      .post('/imports/csv')
      .set('x-api-key', API_KEY)
      .set('Content-Type', 'text/csv')
      .send('a,b\n1,2\n3,4')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ rows: 3 })
  })

  it('rejects an undeclared request content type with 415', async () => {
    const res = await request(app)
      .post('/imports/csv')
      .set('x-api-key', API_KEY)
      .set('Content-Type', 'text/plain')
      .send('not csv')
    expect(res.status).toBe(415)
  })

  it('streams a declared non-JSON response (application/pdf)', async () => {
    const res = await request(app)
      .get('/reports/export.pdf')
      .set('x-api-key', API_KEY)
      .set('Accept', 'application/pdf')
      .buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/pdf/)
    expect(res.text ?? res.body.toString()).toContain('%PDF-1.4')
  })

  it('returns 406 when Accept cannot be satisfied by produces', async () => {
    const res = await request(app)
      .get('/reports/export.pdf')
      .set('x-api-key', API_KEY)
      .set('Accept', 'application/json')
    expect(res.status).toBe(406)
  })
})

// ─── Hierarchical authorization via authorizeCustom ─────────────────────────────

describe('custom endpoints — authorizeCustom (role hierarchy)', () => {
  let app: ReturnType<typeof express>

  beforeAll(() => {
    // Lower role value = more privileged; a caller passes when their value <= the threshold.
    const hierarchy: AuthStrategy = {
      authenticate(req) {
        const value = Number(req.headers['x-role-value'])
        if (!Number.isFinite(value)) throw new AuthenticationError('missing role')
        return { isAuthenticated: true, claims: { roleValue: value } }
      },
      authorizeCustom({ auth, requiredPermissions }) {
        const value = Number(auth.claims?.['roleValue'] ?? Number.MAX_SAFE_INTEGER)
        const thresholds = requiredPermissions
          .filter((p) => p.startsWith('role:'))
          .map((p) => Number(p.slice('role:'.length)))
        return thresholds.length === 0 || thresholds.some((t) => value <= t)
      }
    }
    const built = makeApp(hierarchy)
    app = built.app
    built.api.addCustomEndpoint('POST', '/invite', ['role:3'], async (_req, res) => {
      await res.status(200).json({ invited: true })
    })
  })

  it('allows a more-privileged caller (value 2 <= manager threshold 3)', async () => {
    const res = await request(app).post('/invite').set('x-role-value', '2').send({})
    expect(res.status).toBe(200)
  })

  it('allows an exact-threshold caller (value 3)', async () => {
    const res = await request(app).post('/invite').set('x-role-value', '3').send({})
    expect(res.status).toBe(200)
  })

  it('denies a less-privileged caller (value 4) with 403', async () => {
    const res = await request(app).post('/invite').set('x-role-value', '4').send({})
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/invite').send({})
    expect(res.status).toBe(401)
  })
})

// ─── Per-endpoint authorize predicate ───────────────────────────────────────────

describe('custom endpoints — per-endpoint authorize predicate', () => {
  let app: ReturnType<typeof express>

  beforeAll(() => {
    const sessionStrategy: AuthStrategy = {
      authenticate(req) {
        const user = req.headers['x-auth-user']
        if (!user) throw new AuthenticationError('no session')
        return { isAuthenticated: true, userId: String(user) }
      }
    }
    const built = makeApp(sessionStrategy)
    app = built.app
    built.api.addCustomEndpoint(
      'GET',
      '/orders/:id',
      { authorize: ({ auth, req }) => req.params['id'] === auth.userId },
      async (req, res) => {
        await res.status(200).json({ id: req.params['id'] })
      }
    )
  })

  it('allows when the predicate passes (owner)', async () => {
    const res = await request(app).get('/orders/42').set('x-auth-user', '42')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: '42' })
  })

  it('denies with 403 when the predicate fails (non-owner)', async () => {
    const res = await request(app).get('/orders/42').set('x-auth-user', '99')
    expect(res.status).toBe(403)
  })
})

// ─── CompositeAuthStrategy: multiple credentials per route ───────────────────────

describe('custom endpoints — CompositeAuthStrategy', () => {
  let app: ReturnType<typeof express>

  beforeAll(() => {
    const apiKey = new ApiKeyAuthStrategy(API_KEY, 'x-api-key', ['devices:read'])
    const session: AuthStrategy = {
      authenticate(req) {
        const user = req.headers['x-session-user']
        if (!user) throw new AuthenticationError('no session')
        return { isAuthenticated: true, userId: String(user), roles: ['viewer'] }
      }
    }
    const built = makeApp(new CompositeAuthStrategy([apiKey, session]))
    app = built.app
    built.api
      .addCustomEndpoint('GET', '/any', [], async (_req, res) => {
        await res.status(200).json({ ok: true })
      })
      .addCustomEndpoint('GET', '/devices', ['devices:read'], async (_req, res) => {
        await res.status(200).json({ ok: true })
      })
  })

  it('authenticates via the API key (first strategy)', async () => {
    const res = await request(app).get('/any').set('x-api-key', API_KEY)
    expect(res.status).toBe(200)
  })

  it('falls through to the session strategy when the API key is absent', async () => {
    const res = await request(app).get('/any').set('x-session-user', 'u-1')
    expect(res.status).toBe(200)
  })

  it('returns 401 when no credential matches any strategy', async () => {
    const res = await request(app).get('/any')
    expect(res.status).toBe(401)
  })

  it('grants a scoped route to the API key holding the scope', async () => {
    const res = await request(app).get('/devices').set('x-api-key', API_KEY)
    expect(res.status).toBe(200)
  })

  it('denies a scoped route to a session caller lacking the scope (403)', async () => {
    const res = await request(app).get('/devices').set('x-session-user', 'u-1')
    expect(res.status).toBe(403)
  })
})
