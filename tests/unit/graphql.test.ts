import { describe, it, expect, beforeEach } from 'vitest'
import { graphql, getIntrospectionQuery, buildClientSchema } from 'graphql'
import { registerCrudApi } from '@/core/crudRouter.js'
import type {
  HttpServer,
  HttpRequest,
  HttpResponse,
  Repository,
  ResourceDefinition
} from '@/core/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Row = { id: number; name: string; status?: string; active?: boolean }

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
      return { id: Number(id), name: 'alice', status: 'active', active: true }
    },
    async getMany() {
      return { count: 2, results: [{ id: 1, name: 'alice' }, { id: 2, name: 'bob' }] }
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
      return { updated: [1, 2], results: [{ id: 1, name: 'updated' }] }
    },
    async upsertOne(id, d) {
      return { id: Number(id), ...(d as object) } as Row
    },
    async deleteMany() {
      return { deleted: [1, 2] }
    },
    async executeQuery() {
      return { count: 1, results: [{ id: 1, name: 'alice' }] }
    },
    ...overrides
  }
}

function makeResource(overrides: Partial<ResourceDefinition> = {}): ResourceDefinition {
  return {
    routePrefix: 'users',
    name: 'Users',
    fields: [
      { name: 'id', writable: false, type: 'integer' },
      { name: 'name', writable: true, type: 'string' },
      { name: 'status', writable: true, type: 'string' },
      { name: 'active', writable: true, type: 'boolean' }
    ],
    repository: makeRepo(),
    ...overrides
  }
}

function makeReq(body: unknown = {}): HttpRequest {
  return {
    method: 'POST',
    params: {},
    query: {},
    body,
    headers: { 'content-type': 'application/json' },
    raw: {}
  }
}

function makeRes() {
  let statusCode = 200
  let body: unknown = null
  const res: HttpResponse = {
    status(code) {
      statusCode = code
      return this
    },
    json(payload) {
      body = payload
    },
    send(payload) {
      body = payload
    },
    setHeader() {},
    raw: {}
  }
  return { res, getStatus: () => statusCode, getBody: () => body }
}

async function runGraphQL(
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data?: unknown; errors?: unknown[] }> {
  const { server, routes } = makeServer()
  const resource = makeResource()
  registerCrudApi(server, [resource], { graphql: { enabled: true } })
  const handler = routes.get('POST:/graphql')
  if (!handler) throw new Error('GraphQL route not registered')
  const req = makeReq({ query, variables })
  const { res, getBody } = makeRes()
  await handler(req, res)
  return getBody() as { data?: unknown; errors?: unknown[] }
}

// ─── Schema registration ───────────────────────────────────────────────────────

describe('GraphQL registration', () => {
  it('registers POST /graphql and GET /graphql when graphql is enabled', () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [makeResource()], { graphql: { enabled: true } })
    expect(routes.has('POST:/graphql')).toBe(true)
    expect(routes.has('GET:/graphql')).toBe(true)
  })

  it('does not register GraphQL routes when graphql option is absent', () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [makeResource()], {})
    expect(routes.has('POST:/graphql')).toBe(false)
  })

  it('does not register GraphQL routes when enabled is false', () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [makeResource()], { graphql: { enabled: false } })
    expect(routes.has('POST:/graphql')).toBe(false)
  })

  it('respects custom path', () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [makeResource()], { graphql: { enabled: true, path: '/api/gql' } })
    expect(routes.has('POST:/api/gql')).toBe(true)
  })

  it('omits GET route when graphiql is false', () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [makeResource()], { graphql: { enabled: true, graphiql: false } })
    expect(routes.has('POST:/graphql')).toBe(true)
    expect(routes.has('GET:/graphql')).toBe(false)
  })
})

// ─── Introspection ─────────────────────────────────────────────────────────────

describe('GraphQL introspection', () => {
  it('responds to introspection query', async () => {
    const result = await runGraphQL(getIntrospectionQuery())
    expect(result.errors).toBeUndefined()
    expect(result.data).toBeDefined()
  })

  it('exposes get, list, and query operations for the resource', async () => {
    const result = await runGraphQL('{ __schema { queryType { fields { name } } } }')
    const fields = (result.data as { __schema: { queryType: { fields: { name: string }[] } } })
      .__schema.queryType.fields.map((f: { name: string }) => f.name)
    expect(fields).toContain('getUsers')
    expect(fields).toContain('listUsers')
    expect(fields).toContain('queryUsers')
  })

  it('exposes all mutation operations', async () => {
    const result = await runGraphQL(
      '{ __schema { mutationType { fields { name } } } }'
    )
    const fields = (
      result.data as { __schema: { mutationType: { fields: { name: string }[] } } }
    ).__schema.mutationType.fields.map((f: { name: string }) => f.name)
    expect(fields).toContain('createUsers')
    expect(fields).toContain('createManyUsers')
    expect(fields).toContain('updateUsers')
    expect(fields).toContain('updateManyUsers')
    expect(fields).toContain('upsertUsers')
    expect(fields).toContain('deleteUsers')
    expect(fields).toContain('deleteManyUsers')
  })

  it('excludes resource from schema when graphql: false on resource', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(
      server,
      [{ ...makeResource(), graphql: false }],
      { graphql: { enabled: true } }
    )
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: '{ __schema { queryType { fields { name } } } }' })
    const { res, getBody } = makeRes()
    await handler(req, res)
    const result = getBody() as { data?: unknown }
    const fields = (result.data as { __schema: { queryType: { fields: { name: string }[] } } })
      .__schema.queryType.fields.map((f) => f.name)
    expect(fields).not.toContain('getUsers')
  })
})

// ─── Query: getX ──────────────────────────────────────────────────────────────

describe('getUsers query', () => {
  it('returns a single record by id', async () => {
    const result = await runGraphQL('{ getUsers(id: "1") { id name } }')
    expect(result.errors).toBeUndefined()
    expect((result.data as { getUsers: { id: string; name: string } }).getUsers).toMatchObject({
      name: 'alice'
    })
  })

  it('returns null when not found', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(
      server,
      [makeResource({ repository: makeRepo({ async getOne() { return null } }) })],
      { graphql: { enabled: true } }
    )
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: '{ getUsers(id: "99") { id name } }' })
    const { res, getBody } = makeRes()
    await handler(req, res)
    const result = getBody() as { errors?: { message: string }[] }
    expect(result.errors).toBeDefined()
    expect(result.errors![0]!.message).toMatch(/not found/i)
  })
})

// ─── Query: listX ─────────────────────────────────────────────────────────────

describe('listUsers query', () => {
  it('returns count and results', async () => {
    const result = await runGraphQL('{ listUsers { count results { id name } } }')
    expect(result.errors).toBeUndefined()
    const data = (result.data as { listUsers: { count: number; results: Row[] } }).listUsers
    expect(data.count).toBe(2)
    expect(data.results).toHaveLength(2)
  })

  it('passes filter arg to getMany', async () => {
    let capturedWhere: Record<string, unknown> | undefined
    const { server, routes } = makeServer()
    const repo = makeRepo({
      async getMany(opts) {
        capturedWhere = opts?.where
        return { count: 0, results: [] }
      }
    })
    registerCrudApi(server, [makeResource({ repository: repo })], { graphql: { enabled: true } })
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({
      query: '{ listUsers(filter: { name: "alice" }) { count results { id } } }'
    })
    const { res } = makeRes()
    await handler(req, res)
    expect(capturedWhere).toMatchObject({ name: 'alice' })
  })

  it('passes limit and offset to getMany', async () => {
    let capturedOpts: { limit?: number; offset?: number } | undefined
    const { server, routes } = makeServer()
    const repo = makeRepo({
      async getMany(opts) {
        capturedOpts = opts
        return { count: 0, results: [] }
      }
    })
    registerCrudApi(server, [makeResource({ repository: repo })], { graphql: { enabled: true } })
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: '{ listUsers(limit: 10, offset: 5) { count results { id } } }' })
    const { res } = makeRes()
    await handler(req, res)
    expect(capturedOpts?.limit).toBe(10)
    expect(capturedOpts?.offset).toBe(5)
  })
})

// ─── Query: queryX ────────────────────────────────────────────────────────────

describe('queryUsers query', () => {
  it('executes query with where filter via variables', async () => {
    const result = await runGraphQL(
      `query Q($where: [QueryFilterInput!]) { queryUsers(where: $where) { count results { id name } } }`,
      {
        where: [{ field: 'name', comparison: '=', value1: 'alice' }]
      }
    )
    expect(result.errors).toBeUndefined()
    const data = (result.data as { queryUsers: { count: number; results: Row[] } }).queryUsers
    expect(data.count).toBe(1)
    expect(data.results[0]!.name).toBe('alice')
  })

  it('errors when executeQuery not supported', async () => {
    const { server, routes } = makeServer()
    const repo = makeRepo({ executeQuery: undefined })
    registerCrudApi(server, [makeResource({ repository: repo })], { graphql: { enabled: true } })
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: '{ queryUsers { count results { id } } }' })
    const { res, getBody } = makeRes()
    await handler(req, res)
    const result = getBody() as { errors?: { message: string }[] }
    expect(result.errors).toBeDefined()
    expect(result.errors![0]!.message).toMatch(/query builder/i)
  })
})

// ─── Mutation: createX ────────────────────────────────────────────────────────

describe('createUsers mutation', () => {
  it('creates a single record', async () => {
    const result = await runGraphQL(
      `mutation { createUsers(input: { name: "carol", status: "active" }) { id name status } }`
    )
    expect(result.errors).toBeUndefined()
    const rec = (result.data as { createUsers: Row }).createUsers
    expect(rec.name).toBe('carol')
    expect(rec.status).toBe('active')
  })
})

describe('createManyUsers mutation', () => {
  it('creates multiple records', async () => {
    const result = await runGraphQL(
      `mutation { createManyUsers(input: [{ name: "a" }, { name: "b" }]) { id name } }`
    )
    expect(result.errors).toBeUndefined()
    const results = (result.data as { createManyUsers: Row[] }).createManyUsers
    expect(results).toHaveLength(2)
    expect(results[0]!.name).toBe('a')
  })
})

// ─── Mutation: updateX ────────────────────────────────────────────────────────

describe('updateUsers mutation', () => {
  it('updates a single record', async () => {
    const result = await runGraphQL(
      `mutation { updateUsers(id: "1", input: { name: "updated" }) { id name } }`
    )
    expect(result.errors).toBeUndefined()
    const rec = (result.data as { updateUsers: Row }).updateUsers
    expect(rec?.name).toBe('updated')
  })

  it('errors when not found', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(
      server,
      [makeResource({ repository: makeRepo({ async updateOne() { return null } }) })],
      { graphql: { enabled: true } }
    )
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({
      query: 'mutation { updateUsers(id: "99", input: { name: "x" }) { id } }'
    })
    const { res, getBody } = makeRes()
    await handler(req, res)
    const result = getBody() as { errors?: { message: string }[] }
    expect(result.errors).toBeDefined()
    expect(result.errors![0]!.message).toMatch(/not found/i)
  })
})

// ─── Mutation: updateManyX ────────────────────────────────────────────────────

describe('updateManyUsers mutation', () => {
  it('bulk-updates matching records via variables', async () => {
    const result = await runGraphQL(
      `mutation BulkUpdate($where: [QueryFilterInput!]!, $update: UsersUpdateInput!) {
        updateManyUsers(where: $where, update: $update) { updated }
      }`,
      {
        where: [{ field: 'status', comparison: '=', value1: 'active' }],
        update: { name: 'renamed' }
      }
    )
    expect(result.errors).toBeUndefined()
    const res = (result.data as { updateManyUsers: { updated: string[] } }).updateManyUsers
    expect(res.updated).toHaveLength(2)
  })
})

// ─── Mutation: upsertX ────────────────────────────────────────────────────────

describe('upsertUsers mutation', () => {
  it('upserts a record', async () => {
    const result = await runGraphQL(
      `mutation { upsertUsers(id: "5", input: { name: "dave" }) { id name } }`
    )
    expect(result.errors).toBeUndefined()
    const rec = (result.data as { upsertUsers: Row }).upsertUsers
    // GraphQL ID scalar always serializes to string
    expect(String(rec.id)).toBe('5')
    expect(rec.name).toBe('dave')
  })

  it('errors when upsertOne not supported', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(
      server,
      [makeResource({ repository: makeRepo({ upsertOne: undefined }) })],
      { graphql: { enabled: true } }
    )
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: 'mutation { upsertUsers(id: "5", input: { name: "x" }) { id } }' })
    const { res, getBody } = makeRes()
    await handler(req, res)
    const result = getBody() as { errors?: { message: string }[] }
    expect(result.errors).toBeDefined()
    expect(result.errors![0]!.message).toMatch(/upsert/i)
  })
})

// ─── Mutation: deleteX ────────────────────────────────────────────────────────

describe('deleteUsers mutation', () => {
  it('deletes a record and returns true', async () => {
    const result = await runGraphQL(`mutation { deleteUsers(id: "1") }`)
    expect(result.errors).toBeUndefined()
    expect((result.data as { deleteUsers: boolean }).deleteUsers).toBe(true)
  })

  it('errors when not found', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(
      server,
      [makeResource({ repository: makeRepo({ async deleteOne() { return false } }) })],
      { graphql: { enabled: true } }
    )
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: 'mutation { deleteUsers(id: "99") }' })
    const { res, getBody } = makeRes()
    await handler(req, res)
    const result = getBody() as { errors?: { message: string }[] }
    expect(result.errors).toBeDefined()
    expect(result.errors![0]!.message).toMatch(/not found/i)
  })
})

// ─── Mutation: deleteManyX ────────────────────────────────────────────────────

describe('deleteManyUsers mutation', () => {
  it('bulk-deletes matching records', async () => {
    const result = await runGraphQL(
      `mutation Del($where: [QueryFilterInput!]!) { deleteManyUsers(where: $where) { deleted } }`,
      { where: [{ field: 'status', comparison: '=', value1: 'inactive' }] }
    )
    expect(result.errors).toBeUndefined()
    const res = (result.data as { deleteManyUsers: { deleted: string[] } }).deleteManyUsers
    expect(res.deleted).toHaveLength(2)
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('GraphQL error handling', () => {
  it('returns 400 with message for empty query', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [makeResource()], { graphql: { enabled: true } })
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: '' })
    const { res, getStatus, getBody } = makeRes()
    await handler(req, res)
    expect(getStatus()).toBe(400)
    expect((getBody() as { errors: { message: string }[] }).errors[0]!.message).toMatch(/query/i)
  })

  it('returns 400 for syntax errors', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [makeResource()], { graphql: { enabled: true } })
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: '{ invalid {{{}' })
    const { res, getStatus, getBody } = makeRes()
    await handler(req, res)
    expect(getStatus()).toBe(400)
    expect((getBody() as { errors: { message: string }[] }).errors).toBeDefined()
  })

  it('returns 400 for validation errors (unknown field)', async () => {
    const result = await runGraphQL('{ getUsers(id: "1") { nonExistentField } }')
    expect(result.errors).toBeDefined()
  })

  it('maps NotFoundError to NOT_FOUND GraphQL error', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(
      server,
      [makeResource({ repository: makeRepo({ async getOne() { return null } }) })],
      { graphql: { enabled: true } }
    )
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: '{ getUsers(id: "99") { id } }' })
    const { res, getBody } = makeRes()
    await handler(req, res)
    const result = getBody() as { errors?: Array<{ extensions?: { code: string } }> }
    expect(result.errors![0]!.extensions?.code).toBe('NOT_FOUND')
  })
})

// ─── CrudPermissions respected ────────────────────────────────────────────────

describe('CrudPermissions respected in GraphQL', () => {
  it('omits getX when allowReadOne is false', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(
      server,
      [makeResource({ permissions: { allowReadOne: false } })],
      { graphql: { enabled: true } }
    )
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: '{ __schema { queryType { fields { name } } } }' })
    const { res, getBody } = makeRes()
    await handler(req, res)
    const result = getBody() as { data: { __schema: { queryType: { fields: { name: string }[] } } } }
    const names = result.data.__schema.queryType.fields.map((f) => f.name)
    expect(names).not.toContain('getUsers')
  })

  it('omits createX when allowCreate is false', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(
      server,
      [makeResource({ permissions: { allowCreate: false } })],
      { graphql: { enabled: true } }
    )
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: '{ __schema { mutationType { fields { name } } } }' })
    const { res, getBody } = makeRes()
    await handler(req, res)
    const result = getBody() as { data: { __schema: { mutationType: { fields: { name: string }[] } | null } } }
    const mutationType = result.data.__schema.mutationType
    if (mutationType) {
      const names = mutationType.fields.map((f) => f.name)
      expect(names).not.toContain('createUsers')
      expect(names).not.toContain('createManyUsers')
    }
  })
})

// ─── Field-level auth (readRoles) ─────────────────────────────────────────────

describe('Field-level readRoles respected', () => {
  it('strips restricted fields for unauthenticated callers', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(
      server,
      [
        makeResource({
          fields: [
            { name: 'id', writable: false, type: 'integer' },
            { name: 'name', writable: true, type: 'string' },
            { name: 'status', writable: true, type: 'string', readRoles: ['admin'] }
          ]
        })
      ],
      { graphql: { enabled: true } }
    )
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: '{ getUsers(id: "1") { id name status } }' })
    const { res, getBody } = makeRes()
    await handler(req, res)
    const result = getBody() as { data: { getUsers: Record<string, unknown> } }
    expect(result.data.getUsers.name).toBe('alice')
    expect(result.data.getUsers.status).toBeNull()
  })
})

// ─── Multiple resources ───────────────────────────────────────────────────────

describe('Multiple resources', () => {
  it('registers operations for all GraphQL-enabled resources', async () => {
    const { server, routes } = makeServer()
    const posts: ResourceDefinition = {
      routePrefix: 'posts',
      fields: [{ name: 'id', writable: false }, { name: 'title', writable: true }],
      repository: makeRepo()
    }
    registerCrudApi(server, [makeResource(), posts], { graphql: { enabled: true } })
    const handler = routes.get('POST:/graphql')!
    const req = makeReq({ query: '{ __schema { queryType { fields { name } } } }' })
    const { res, getBody } = makeRes()
    await handler(req, res)
    const result = getBody() as { data: { __schema: { queryType: { fields: { name: string }[] } } } }
    const names = result.data.__schema.queryType.fields.map((f) => f.name)
    expect(names).toContain('getUsers')
    expect(names).toContain('getPosts')
  })
})

// ─── GraphiQL HTML endpoint ───────────────────────────────────────────────────

describe('GraphiQL GET endpoint', () => {
  it('serves HTML containing graphiql', async () => {
    const { server, routes } = makeServer()
    registerCrudApi(server, [makeResource()], { graphql: { enabled: true } })
    const handler = routes.get('GET:/graphql')!
    expect(handler).toBeDefined()
    const req = { method: 'GET', params: {}, query: {}, body: undefined, headers: {}, raw: {} }
    let sentBody = ''
    const res: HttpResponse = {
      status() { return this },
      json() {},
      send(payload) { sentBody = String(payload) },
      setHeader() {},
      raw: {}
    }
    await handler(req as HttpRequest, res)
    expect(sentBody).toContain('graphiql')
    expect(sentBody).toContain('/graphql')
  })
})
