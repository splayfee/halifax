import { vi, describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { createFastifyCrudPlugin, FastifyHttpServer } from '@/adapters/http/FastifyAdapter.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import {
  CONTRACT_API_KEY,
  CONTRACT_PREFIX,
  contractResources,
  runAdapterContract
} from '../helpers/adapterContract.js'
import type { FastifyAppLike } from '@/adapters/http/FastifyAdapter.js'
import type { HttpMethod } from '@/core/types.js'

// Fastify's `app.server` is a Node http.Server, so supertest can drive it in-process
// after `ready()` — no real port binding required.
runAdapterContract('Fastify', async () => {
  const app = Fastify()
  await app.register(
    createFastifyCrudPlugin(contractResources(), {
      authStrategy: new ApiKeyAuthStrategy(CONTRACT_API_KEY)
    }),
    { prefix: CONTRACT_PREFIX }
  )
  await app.ready()

  return {
    target: app.server,
    close: () => app.close()
  }
})

// ─── FastifyHttpServer unit tests ─────────────────────────────────────────────

function makeFastifyApp() {
  return {
    route: vi.fn(),
    addContentTypeParser: vi.fn(),
    listen: vi.fn().mockResolvedValue('localhost:3000')
  }
}

function makeServer() {
  const app = makeFastifyApp()
  const server = new FastifyHttpServer(app as unknown as FastifyAppLike)
  return { server, app }
}

describe('FastifyHttpServer — constructor', () => {
  it('ignores the error when addContentTypeParser throws (parser already registered)', () => {
    const app = makeFastifyApp()
    app.addContentTypeParser = vi.fn().mockImplementation(() => {
      throw new Error('already registered')
    })
    expect(() => new FastifyHttpServer(app as unknown as FastifyAppLike)).not.toThrow()
  })
})

describe('FastifyHttpServer — registerRoute wildcard', () => {
  it('does not register the wildcard route when all methods are already bound', () => {
    const { server, app } = makeServer()
    // Register every method that ALL_METHODS contains
    for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']) {
      server.registerRoute(method as HttpMethod, '/items', vi.fn())
    }
    const routeSpy = vi.spyOn(app, 'route')
    routeSpy.mockClear()
    server.registerRoute('*', '/items', vi.fn())
    expect(routeSpy).not.toHaveBeenCalled()
  })
})

describe('FastifyHttpServer — start', () => {
  it('calls listen with port and host when host is provided', async () => {
    const { server, app } = makeServer()
    const listenSpy = vi.spyOn(app, 'listen').mockResolvedValue('localhost:3001')
    await server.start(3001, '127.0.0.1')
    expect(listenSpy).toHaveBeenCalledWith({ port: 3001, host: '127.0.0.1' })
  })
})
