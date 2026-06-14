import { describe, it, expect } from 'vitest'
import { registerCrudApi } from '@/core/crudRouter.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'
import { BadRequestError } from '@/errors/BadRequestError.js'
import type { CrudHooks, HookContext } from '@/core/hooks.js'
import type {
  HttpServer,
  HttpRequest,
  HttpResponse,
  Repository,
  ResourceDefinition
} from '@/core/types.js'

// ─── Minimal test harness ──────────────────────────────────────────────────────

type Row = { id: number; name: string; secret?: string }

/** Captures registered routes by method+path so tests can invoke them directly. */
function makeServer() {
  const routes = new Map<string, (req: HttpRequest, res: HttpResponse) => Promise<void> | void>()
  const server: HttpServer = {
    registerRoute(method, path, handler) {
      routes.set(`${method}:${path}`, handler)
    },
    async start() {}
  }
  return { server, routes }
}

function makeRepo(overrides: Partial<Repository<Row>> = {}): Repository<Row> {
  return {
    async getOne(id) {
      return { id: Number(id), name: 'alice' }
    },
    async getMany() {
      return { count: 1, results: [{ id: 1, name: 'alice' }] }
    },
    async createOne(d) {
      return { id: 99, ...(d as object) } as Row
    },
    async createMany(d) {
      return d.map((item, i) => ({ id: i + 1, ...(item as object) }) as Row)
    },
    async updateOne(id, d) {
      return { id: Number(id), name: 'alice', ...(d as object) } as Row
    },
    async deleteOne() {
      return true
    },
    async updateMany() {
      return { updated: [1], results: [{ id: 1, name: 'updated' }] }
    },
    async upsertOne(id, d) {
      return { id: Number(id), ...(d as object) } as Row
    },
    async deleteMany() {
      return { deleted: [1] }
    },
    async executeQuery() {
      return { count: 1, results: [{ id: 1, name: 'alice' }] }
    },
    ...overrides
  }
}

/** Builds a minimal HttpRequest for a given method / path. */
function makeReq(
  method: string,
  params: Record<string, string> = {},
  body: unknown = {},
  query: Record<string, unknown> = {}
): HttpRequest {
  return {
    method,
    params,
    query,
    body,
    headers: { 'content-type': 'application/json' },
    raw: {}
  }
}

/** Captures the JSON payload sent by a route handler. */
function makeRes() {
  let statusCode = 0
  let payload: unknown
  const res: HttpResponse = {
    raw: {},
    status(code) {
      statusCode = code
      return this
    },
    json(p) {
      payload = p
    },
    send(p) {
      payload = p
    },
    setHeader() {}
  }
  return { res, getStatus: () => statusCode, getPayload: () => payload }
}

async function invoke(
  routes: Map<string, (req: HttpRequest, res: HttpResponse) => Promise<void> | void>,
  method: string,
  path: string,
  req: HttpRequest,
  res: HttpResponse
) {
  const handler = routes.get(`${method}:${path}`)
  if (!handler) throw new Error(`No handler for ${method}:${path}`)
  await handler(req, res)
}

function makeResource(
  hooks: CrudHooks<Row> = {},
  repoOverrides: Partial<Repository<Row>> = {}
): ResourceDefinition {
  return {
    routePrefix: 'rows',
    fields: [{ name: 'id', writable: false }, { name: 'name' }, { name: 'secret' }],
    repository: makeRepo(repoOverrides),
    hooks
  }
}

// ─── beforeCreate ─────────────────────────────────────────────────────────────

describe('beforeCreate', () => {
  it('transforms single-record create input', async () => {
    let received: unknown
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeCreate: (data) => {
          received = data
          return { ...(data as object), name: 'hooked' } as Row
        }
      })
    ])
    const { res, getPayload } = makeRes()
    await invoke(routes, 'POST', '/rows', makeReq('POST', {}, { name: 'original' }), res)
    expect(received).toMatchObject({ name: 'original' })
    expect((getPayload() as Record<string, unknown>)['name']).toBe('hooked')
  })

  it('transforms each item in a bulk create', async () => {
    const callCount = { n: 0 }
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeCreate: (data) => {
          callCount.n++
          return { ...(data as object), name: 'hooked' } as Row
        }
      })
    ])
    const { res } = makeRes()
    await invoke(routes, 'POST', '/rows', makeReq('POST', {}, [{ name: 'a' }, { name: 'b' }]), res)
    expect(callCount.n).toBe(2)
  })

  it('aborts the create when the hook throws', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeCreate: () => {
          throw new BadRequestError('no go')
        }
      })
    ])
    const { res, getStatus, getPayload } = makeRes()
    await invoke(routes, 'POST', '/rows', makeReq('POST', {}, { name: 'x' }), res)
    expect(getStatus()).toBe(400)
    expect((getPayload() as Record<string, unknown[]>)['errors']![0]).toMatchObject({
      message: 'no go'
    })
  })

  it('void return leaves data unchanged', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeCreate: () => {
          /* return void */
        }
      })
    ])
    const { res, getPayload } = makeRes()
    await invoke(routes, 'POST', '/rows', makeReq('POST', {}, { name: 'original' }), res)
    expect((getPayload() as Record<string, unknown>)['name']).toBe('original')
  })
})

// ─── afterCreate ──────────────────────────────────────────────────────────────

describe('afterCreate', () => {
  it('transforms the result returned to the client', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        afterCreate: (result) => ({ ...result, name: 'after-hooked' })
      })
    ])
    const { res, getPayload } = makeRes()
    await invoke(routes, 'POST', '/rows', makeReq('POST', {}, { name: 'x' }), res)
    expect((getPayload() as Record<string, unknown>)['name']).toBe('after-hooked')
  })

  it('receives ctx with auth, resource, and req', async () => {
    let capturedCtx: HookContext | undefined
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        afterCreate: (result, ctx) => {
          capturedCtx = ctx
          return result
        }
      })
    ])
    const { res } = makeRes()
    await invoke(routes, 'POST', '/rows', makeReq('POST', {}, { name: 'x' }), res)
    expect(capturedCtx?.resource.routePrefix).toBe('rows')
    expect(capturedCtx?.auth).toBeDefined()
  })

  it('fires per-item in bulk create', async () => {
    const afterResults: unknown[] = []
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        afterCreate: (result) => {
          afterResults.push(result)
          return result
        }
      })
    ])
    const { res } = makeRes()
    await invoke(routes, 'POST', '/rows', makeReq('POST', {}, [{ name: 'a' }, { name: 'b' }]), res)
    expect(afterResults).toHaveLength(2)
  })
})

// ─── beforeReadOne ────────────────────────────────────────────────────────────

describe('beforeReadOne', () => {
  it('fires before the DB fetch', async () => {
    const order: string[] = []
    const repo = makeRepo({
      async getOne(id) {
        order.push('db')
        return { id: Number(id), name: 'alice' }
      }
    })
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      {
        ...makeResource({
          beforeReadOne: () => {
            order.push('hook')
          }
        }),
        repository: repo
      }
    ])
    const { res } = makeRes()
    await invoke(routes, 'GET', '/rows/:id', makeReq('GET', { id: '1' }), res)
    expect(order).toEqual(['hook', 'db'])
  })

  it('aborts the read when the hook throws', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeReadOne: () => {
          throw new AuthorizationError('nope')
        }
      })
    ])
    const { res, getStatus } = makeRes()
    await invoke(routes, 'GET', '/rows/:id', makeReq('GET', { id: '1' }), res)
    expect(getStatus()).toBe(403)
  })
})

// ─── afterReadOne ─────────────────────────────────────────────────────────────

describe('afterReadOne', () => {
  it('transforms the fetched record', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        afterReadOne: (result) => ({ ...result, name: 'transformed' })
      })
    ])
    const { res, getPayload } = makeRes()
    await invoke(routes, 'GET', '/rows/:id', makeReq('GET', { id: '1' }), res)
    expect((getPayload() as Record<string, unknown>)['name']).toBe('transformed')
  })
})

// ─── beforeReadMany ───────────────────────────────────────────────────────────

describe('beforeReadMany', () => {
  it('can modify the list options passed to the repository', async () => {
    let receivedLimit: number | undefined
    const repo = makeRepo({
      async getMany(opts) {
        receivedLimit = opts?.limit
        return { count: 0, results: [] }
      }
    })
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      {
        ...makeResource({ beforeReadMany: (opts) => ({ ...opts, limit: 7 }) }),
        repository: repo
      }
    ])
    const { res } = makeRes()
    await invoke(routes, 'GET', '/rows', makeReq('GET'), res)
    expect(receivedLimit).toBe(7)
  })

  it('aborts when the hook throws', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeReadMany: () => {
          throw new AuthorizationError()
        }
      })
    ])
    const { res, getStatus } = makeRes()
    await invoke(routes, 'GET', '/rows', makeReq('GET'), res)
    expect(getStatus()).toBe(403)
  })
})

// ─── afterReadMany ────────────────────────────────────────────────────────────

describe('afterReadMany', () => {
  it('transforms the list result', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        afterReadMany: (result) => ({ ...result, count: 999 })
      })
    ])
    const { res, getPayload } = makeRes()
    await invoke(routes, 'GET', '/rows', makeReq('GET'), res)
    expect((getPayload() as Record<string, unknown>)['count']).toBe(999)
  })
})

// ─── beforeUpdateOne ──────────────────────────────────────────────────────────

describe('beforeUpdateOne', () => {
  it('transforms the update payload', async () => {
    let dbInput: unknown
    const repo = makeRepo({
      async updateOne(id, data) {
        dbInput = data
        return { id: Number(id), name: 'x', ...(data as object) } as Row
      }
    })
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      {
        ...makeResource({
          beforeUpdateOne: (_id, data) => ({ ...(data as object), name: 'stamped' }) as Row
        }),
        repository: repo
      }
    ])
    const { res } = makeRes()
    await invoke(
      routes,
      'PATCH',
      '/rows/:id',
      makeReq('PATCH', { id: '1' }, { name: 'original' }),
      res
    )
    expect((dbInput as Record<string, unknown>)['name']).toBe('stamped')
  })

  it('passes id to the hook', async () => {
    let receivedId: unknown
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeUpdateOne: (id) => {
          receivedId = id
        }
      })
    ])
    const { res } = makeRes()
    await invoke(routes, 'PATCH', '/rows/:id', makeReq('PATCH', { id: '42' }, { name: 'x' }), res)
    expect(receivedId).toBe(42)
  })

  it('aborts when the hook throws', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeUpdateOne: () => {
          throw new BadRequestError('invalid')
        }
      })
    ])
    const { res, getStatus } = makeRes()
    await invoke(routes, 'PATCH', '/rows/:id', makeReq('PATCH', { id: '1' }, { name: 'x' }), res)
    expect(getStatus()).toBe(400)
  })
})

// ─── afterUpdateOne ───────────────────────────────────────────────────────────

describe('afterUpdateOne', () => {
  it('transforms the result returned to the client', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        afterUpdateOne: (result) => ({ ...result, name: 'after' })
      })
    ])
    const { res, getPayload } = makeRes()
    await invoke(routes, 'PATCH', '/rows/:id', makeReq('PATCH', { id: '1' }, { name: 'x' }), res)
    expect((getPayload() as Record<string, unknown>)['name']).toBe('after')
  })
})

// ─── beforeUpdateMany ─────────────────────────────────────────────────────────

describe('beforeUpdateMany', () => {
  it('fires before the bulk update', async () => {
    const called = { n: false }
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeUpdateMany: () => {
          called.n = true
        }
      })
    ])
    const { res } = makeRes()
    const body = { where: [{ field: 'id', comparison: '=', value1: 1 }], update: { name: 'x' } }
    await invoke(routes, 'PATCH', '/rows', makeReq('PATCH', {}, body), res)
    expect(called.n).toBe(true)
  })

  it('aborts when the hook throws', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeUpdateMany: () => {
          throw new AuthorizationError('denied')
        }
      })
    ])
    const { res, getStatus } = makeRes()
    const body = { where: [{ field: 'id', comparison: '=', value1: 1 }], update: { name: 'x' } }
    await invoke(routes, 'PATCH', '/rows', makeReq('PATCH', {}, body), res)
    expect(getStatus()).toBe(403)
  })
})

// ─── afterUpdateMany ──────────────────────────────────────────────────────────

describe('afterUpdateMany', () => {
  it('transforms the bulk update result', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        afterUpdateMany: (result) => ({ ...result, updated: [42] })
      })
    ])
    const { res, getPayload } = makeRes()
    const body = { where: [{ field: 'id', comparison: '=', value1: 1 }], update: { name: 'x' } }
    await invoke(routes, 'PATCH', '/rows', makeReq('PATCH', {}, body), res)
    expect((getPayload() as Record<string, unknown[]>)['updated']).toEqual([42])
  })
})

// ─── beforeUpsertOne ──────────────────────────────────────────────────────────

describe('beforeUpsertOne', () => {
  it('transforms the upsert payload', async () => {
    let dbInput: unknown
    const repo = makeRepo({
      async upsertOne(id, data) {
        dbInput = data
        return { id: Number(id), ...(data as object) } as Row
      }
    })
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      {
        ...makeResource({
          beforeUpsertOne: (_id, data) => ({ ...(data as object), name: 'upsert-hooked' }) as Row
        }),
        repository: repo
      }
    ])
    const { res } = makeRes()
    await invoke(routes, 'PUT', '/rows/:id', makeReq('PUT', { id: '1' }, { name: 'original' }), res)
    expect((dbInput as Record<string, unknown>)['name']).toBe('upsert-hooked')
  })
})

// ─── afterUpsertOne ───────────────────────────────────────────────────────────

describe('afterUpsertOne', () => {
  it('transforms the upsert result', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        afterUpsertOne: (result) => ({ ...result, name: 'after-upsert' })
      })
    ])
    const { res, getPayload } = makeRes()
    await invoke(routes, 'PUT', '/rows/:id', makeReq('PUT', { id: '1' }, { name: 'x' }), res)
    expect((getPayload() as Record<string, unknown>)['name']).toBe('after-upsert')
  })
})

// ─── beforeDeleteOne ──────────────────────────────────────────────────────────

describe('beforeDeleteOne', () => {
  it('fires before the delete', async () => {
    const order: string[] = []
    const repo = makeRepo({
      async deleteOne() {
        order.push('db')
        return true
      }
    })
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      {
        ...makeResource({
          beforeDeleteOne: () => {
            order.push('hook')
          }
        }),
        repository: repo
      }
    ])
    const { res } = makeRes()
    await invoke(routes, 'DELETE', '/rows/:id', makeReq('DELETE', { id: '1' }), res)
    expect(order).toEqual(['hook', 'db'])
  })

  it('aborts when the hook throws', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeDeleteOne: () => {
          throw new AuthorizationError()
        }
      })
    ])
    const { res, getStatus } = makeRes()
    await invoke(routes, 'DELETE', '/rows/:id', makeReq('DELETE', { id: '1' }), res)
    expect(getStatus()).toBe(403)
  })
})

// ─── afterDeleteOne ───────────────────────────────────────────────────────────

describe('afterDeleteOne', () => {
  it('fires after a successful delete with the deleted id', async () => {
    let deletedId: unknown
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        afterDeleteOne: (id) => {
          deletedId = id
        }
      })
    ])
    const { res, getStatus } = makeRes()
    await invoke(routes, 'DELETE', '/rows/:id', makeReq('DELETE', { id: '7' }), res)
    expect(getStatus()).toBe(200)
    expect(deletedId).toBe(7)
  })

  it('does not fire when the record is not found', async () => {
    const called = { n: false }
    const repo = makeRepo({
      async deleteOne() {
        return false
      }
    })
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      {
        ...makeResource({
          afterDeleteOne: () => {
            called.n = true
          }
        }),
        repository: repo
      }
    ])
    const { res, getStatus } = makeRes()
    await invoke(routes, 'DELETE', '/rows/:id', makeReq('DELETE', { id: '1' }), res)
    expect(getStatus()).toBe(404)
    expect(called.n).toBe(false)
  })
})

// ─── beforeDeleteMany ─────────────────────────────────────────────────────────

describe('beforeDeleteMany', () => {
  it('fires with the query before the bulk delete', async () => {
    let capturedQuery: unknown
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeDeleteMany: (query) => {
          capturedQuery = query
        }
      })
    ])
    const { res } = makeRes()
    const body = { where: [{ field: 'id', comparison: '=', value1: 1 }] }
    await invoke(routes, 'DELETE', '/rows', makeReq('DELETE', {}, body), res)
    expect((capturedQuery as Record<string, unknown>)['where']).toBeDefined()
  })

  it('aborts when the hook throws', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeDeleteMany: () => {
          throw new AuthorizationError('denied')
        }
      })
    ])
    const { res, getStatus } = makeRes()
    const body = { where: [{ field: 'id', comparison: '=', value1: 1 }] }
    await invoke(routes, 'DELETE', '/rows', makeReq('DELETE', {}, body), res)
    expect(getStatus()).toBe(403)
  })
})

// ─── afterDeleteMany ──────────────────────────────────────────────────────────

describe('afterDeleteMany', () => {
  it('transforms the bulk delete result', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        afterDeleteMany: () => ({ deleted: [42, 43] })
      })
    ])
    const { res, getPayload } = makeRes()
    const body = { where: [{ field: 'id', comparison: '=', value1: 1 }] }
    await invoke(routes, 'DELETE', '/rows', makeReq('DELETE', {}, body), res)
    expect((getPayload() as Record<string, unknown[]>)['deleted']).toEqual([42, 43])
  })
})

// ─── beforeQuery ──────────────────────────────────────────────────────────────

describe('beforeQuery', () => {
  it('can modify the query sent to executeQuery', async () => {
    let capturedQuery: unknown
    const repo = makeRepo({
      async executeQuery(q) {
        capturedQuery = q
        return { count: 0, results: [] }
      }
    })
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      {
        ...makeResource({ beforeQuery: (q) => ({ ...q, limit: 5 }) }),
        repository: repo
      }
    ])
    const { res } = makeRes()
    await invoke(routes, 'POST', '/rows/query', makeReq('POST', {}, {}), res)
    expect((capturedQuery as Record<string, unknown>)['limit']).toBe(5)
  })

  it('aborts when the hook throws', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        beforeQuery: () => {
          throw new AuthorizationError()
        }
      })
    ])
    const { res, getStatus } = makeRes()
    await invoke(routes, 'POST', '/rows/query', makeReq('POST', {}, {}), res)
    expect(getStatus()).toBe(403)
  })
})

// ─── afterQuery ───────────────────────────────────────────────────────────────

describe('afterQuery', () => {
  it('transforms the query result', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [
      makeResource({
        afterQuery: (result) => ({ ...result, count: 777 })
      })
    ])
    const { res, getPayload } = makeRes()
    await invoke(routes, 'POST', '/rows/query', makeReq('POST', {}, {}), res)
    expect((getPayload() as Record<string, unknown>)['count']).toBe(777)
  })
})

// ─── No-op when hooks are absent ──────────────────────────────────────────────

describe('no hooks defined', () => {
  it('all CRUD routes work normally without any hooks set', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [makeResource()])

    const { res: r1, getStatus: s1, getPayload: p1 } = makeRes()
    await invoke(routes, 'POST', '/rows', makeReq('POST', {}, { name: 'x' }), r1)
    expect(s1()).toBe(201)
    expect((p1() as Record<string, unknown>)['name']).toBe('x')

    const { res: r2, getStatus: s2 } = makeRes()
    await invoke(routes, 'GET', '/rows', makeReq('GET'), r2)
    expect(s2()).toBe(200)

    const { res: r3, getStatus: s3 } = makeRes()
    await invoke(routes, 'GET', '/rows/:id', makeReq('GET', { id: '1' }), r3)
    expect(s3()).toBe(200)

    const { res: r4, getStatus: s4 } = makeRes()
    await invoke(routes, 'PATCH', '/rows/:id', makeReq('PATCH', { id: '1' }, { name: 'y' }), r4)
    expect(s4()).toBe(200)

    const { res: r5, getStatus: s5 } = makeRes()
    await invoke(routes, 'DELETE', '/rows/:id', makeReq('DELETE', { id: '1' }), r5)
    expect(s5()).toBe(200)
  })
})
