import { ResourceClient } from '@/ResourceClient'
import { QueryBuilder } from '@/QueryBuilder'
import { SqlComparison } from '@edium/halifax-types'

function makeRequest() {
  const fn = vi.fn().mockResolvedValue({ id: 1 })
  const client = new ResourceClient<
    { id: number; name: string },
    { name: string },
    { name?: string }
  >('users', fn, 'query')
  return { fn, client }
}

describe('ResourceClient — CRUD methods', () => {
  describe('getOne()', () => {
    it('sends GET /users/:id', async () => {
      const { fn, client } = makeRequest()
      await client.getOne(5)
      expect(fn).toHaveBeenCalledWith('GET', '/users/5')
    })

    it('appends query string for params', async () => {
      const { fn, client } = makeRequest()
      await client.getOne(5, { fields: ['id', 'name'] })
      const [, path] = fn.mock.calls[0]! as [string, string]
      expect(path).toContain('/users/5?')
      expect(path).toContain('fields=id%2Cname')
    })

    it('accepts a string id', async () => {
      const { fn, client } = makeRequest()
      await client.getOne('abc')
      expect(fn).toHaveBeenCalledWith('GET', '/users/abc')
    })
  })

  describe('getMany()', () => {
    it('sends GET /users with no params', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ data: [], total: 0 })
      await client.getMany()
      expect(fn).toHaveBeenCalledWith('GET', '/users')
    })

    it('appends limit and offset as query string', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ data: [], total: 0 })
      await client.getMany({ limit: 10, offset: 20 })
      const [, path] = fn.mock.calls[0]! as [string, string]
      expect(path).toContain('limit=10')
      expect(path).toContain('offset=20')
    })

    it('serializes array params as comma-joined string', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ data: [], total: 0 })
      await client.getMany({ fields: ['id', 'name', 'email'] })
      const [, path] = fn.mock.calls[0]! as [string, string]
      expect(path).toContain('fields=id%2Cname%2Cemail')
    })

    it('omits keys with null or undefined values', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ data: [], total: 0 })
      // Use the index signature ([key: string]: unknown) to pass null/undefined without TS errors
      await client.getMany({ customFilter: null, otherFilter: undefined })
      const [, path] = fn.mock.calls[0]! as [string, string]
      expect(path).toBe('/users')
    })
  })

  describe('createOne()', () => {
    it('sends POST /users with body', async () => {
      const { fn, client } = makeRequest()
      await client.createOne({ name: 'alice' })
      expect(fn).toHaveBeenCalledWith('POST', '/users', { name: 'alice' })
    })
  })

  describe('createMany()', () => {
    it('sends POST /users with an array body', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      await client.createMany([{ name: 'alice' }, { name: 'bob' }])
      expect(fn).toHaveBeenCalledWith('POST', '/users', [{ name: 'alice' }, { name: 'bob' }])
    })
  })

  describe('updateOne()', () => {
    it('sends PATCH /users/:id with body', async () => {
      const { fn, client } = makeRequest()
      await client.updateOne(3, { name: 'carol' })
      expect(fn).toHaveBeenCalledWith('PATCH', '/users/3', { name: 'carol' })
    })
  })

  describe('updateMany()', () => {
    it('sends PATCH /users with merged query+update body (raw IQueryOptions)', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ affected: 2, data: [] })
      await client.updateMany(
        { where: [{ field: 'status', comparison: SqlComparison.Equal, value1: 'active' }] },
        { name: 'x' }
      )
      const [method, path, body] = fn.mock.calls[0]! as [string, string, unknown]
      expect(method).toBe('PATCH')
      expect(path).toBe('/users')
      expect(body).toMatchObject({ update: { name: 'x' } })
    })

    it('sends PATCH /users using a QueryBuilder', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ affected: 1, data: [] })
      const qb = new QueryBuilder().where('status', SqlComparison.Equal, 'inactive')
      await client.updateMany(qb, { name: 'y' })
      const [, , body] = fn.mock.calls[0]! as [string, string, unknown]
      expect(body).toMatchObject({ update: { name: 'y' } })
    })
  })

  describe('upsertOne()', () => {
    it('sends PUT /users/:id with body', async () => {
      const { fn, client } = makeRequest()
      await client.upsertOne(7, { name: 'dave' })
      expect(fn).toHaveBeenCalledWith('PUT', '/users/7', { name: 'dave' })
    })
  })

  describe('deleteOne()', () => {
    it('sends DELETE /users/:id', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ deleted: true })
      await client.deleteOne(9)
      expect(fn).toHaveBeenCalledWith('DELETE', '/users/9')
    })
  })

  describe('deleteMany()', () => {
    it('sends DELETE /users with raw query body', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ affected: 3 })
      const q = { where: [{ field: 'status', comparison: SqlComparison.Equal, value1: 'deleted' }] }
      await client.deleteMany(q)
      const [method, path, body] = fn.mock.calls[0]! as [string, string, unknown]
      expect(method).toBe('DELETE')
      expect(path).toBe('/users')
      expect(body).toEqual(q)
    })

    it('sends DELETE /users with a QueryBuilder', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ affected: 2 })
      const qb = new QueryBuilder().where('status', SqlComparison.Equal, 'gone')
      await client.deleteMany(qb)
      const [method, path] = fn.mock.calls[0]! as [string, string]
      expect(method).toBe('DELETE')
      expect(path).toBe('/users')
    })
  })

  describe('query()', () => {
    it('sends POST /users/query with a raw IQueryOptions body', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ data: [], total: 0 })
      const q = { where: [{ field: 'id', comparison: SqlComparison.Equal, value1: 1 }] }
      await client.query(q)
      expect(fn).toHaveBeenCalledWith('POST', '/users/query', q)
    })

    it('sends POST /users/query with a built QueryBuilder', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ data: [], total: 0 })
      const qb = new QueryBuilder().where('id', SqlComparison.Equal, 1)
      await client.query(qb)
      const [method, path, body] = fn.mock.calls[0]! as [string, string, unknown]
      expect(method).toBe('POST')
      expect(path).toBe('/users/query')
      expect(body).toEqual(qb.build())
    })

    it('uses the custom queryBuilderPath when set', async () => {
      const fn = vi.fn().mockResolvedValue({ data: [], total: 0 })
      const client = new ResourceClient('posts', fn, 'search')
      await client.query({})
      const [, path] = fn.mock.calls[0]! as [string, string]
      expect(path).toBe('/posts/search')
    })
  })
})

describe('ResourceClient — query key helpers', () => {
  const { client } = makeRequest()

  describe('listKey()', () => {
    it('returns [prefix, "list", {}] with no params', () => {
      expect(client.listKey()).toEqual(['users', 'list', {}])
    })

    it('returns [prefix, "list", params] with params', () => {
      expect(client.listKey({ limit: 5 })).toEqual(['users', 'list', { limit: 5 }])
    })
  })

  describe('detailKey()', () => {
    it('returns [prefix, "detail", id, {}] with no params', () => {
      expect(client.detailKey(1)).toEqual(['users', 'detail', 1, {}])
    })

    it('returns [prefix, "detail", id, params] with params', () => {
      expect(client.detailKey('abc', { fields: ['id'] })).toEqual([
        'users',
        'detail',
        'abc',
        { fields: ['id'] }
      ])
    })
  })

  describe('queryKey()', () => {
    it('resolves a QueryBuilder before building the key', () => {
      const qb = new QueryBuilder().where('id', SqlComparison.Equal, 1)
      expect(client.queryKey(qb)).toEqual(['users', 'query', qb.build()])
    })

    it('uses raw IQueryOptions directly', () => {
      const q = { where: [] }
      expect(client.queryKey(q)).toEqual(['users', 'query', q])
    })
  })
})

describe('ResourceClient — TanStack Query option factories', () => {
  describe('getManyOptions()', () => {
    it('returns a queryKey and queryFn that calls getMany', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ data: [], total: 0 })
      const opts = client.getManyOptions({ limit: 5 })
      expect(opts.queryKey).toEqual(['users', 'list', { limit: 5 }])
      await opts.queryFn()
      expect(fn).toHaveBeenCalledWith('GET', expect.stringContaining('/users'))
    })
  })

  describe('getOneOptions()', () => {
    it('returns a queryKey and queryFn that calls getOne', async () => {
      const { fn, client } = makeRequest()
      const opts = client.getOneOptions(42)
      expect(opts.queryKey).toEqual(['users', 'detail', 42, {}])
      await opts.queryFn()
      expect(fn).toHaveBeenCalledWith('GET', '/users/42')
    })
  })

  describe('queryOptions()', () => {
    it('returns a queryKey and queryFn that calls query', async () => {
      const { fn, client } = makeRequest()
      fn.mockResolvedValueOnce({ data: [], total: 0 })
      const q = { where: [] }
      const opts = client.queryOptions(q)
      expect(opts.queryKey).toEqual(['users', 'query', q])
      await opts.queryFn()
      expect(fn).toHaveBeenCalledWith('POST', '/users/query', q)
    })
  })
})
