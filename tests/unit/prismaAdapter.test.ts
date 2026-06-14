import { describe, it, expect, vi } from 'vitest'
import { PrismaAdapter, createPrismaResources } from '@/adapters/orm/prisma/index.js'
import { toRoutePrefix } from '@/adapters/orm/prisma/helpers.js'
import type { ModelSchema } from '@/core/types.js'
import { SqlComparison } from '@edium/halifax-types'

type Row = { id: number; email: string }

function makeDelegate(overrides: Record<string, unknown> = {}) {
  return {
    findUnique: vi.fn().mockResolvedValue({ id: 1, email: 'a@test.com' }),
    findFirst: vi.fn().mockResolvedValue({ id: 1, email: 'a@test.com' }),
    findMany: vi.fn().mockResolvedValue([{ id: 1, email: 'a@test.com' }]),
    count: vi.fn().mockResolvedValue(1),
    create: vi
      .fn()
      .mockImplementation(({ data }: { data: Partial<Row> }) =>
        Promise.resolve({ id: 99, email: '', ...data } as Row)
      ),
    createMany: vi.fn().mockResolvedValue({ count: 2 }),
    updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    update: vi
      .fn()
      .mockImplementation(({ data }: { data: Partial<Row> }) =>
        Promise.resolve({ id: 1, email: '', ...data } as Row)
      ),
    upsert: vi
      .fn()
      .mockImplementation(({ create }: { create: Partial<Row> }) =>
        Promise.resolve({ id: 1, ...create } as Row)
      ),
    delete: vi.fn().mockResolvedValue({ id: 1, email: 'a@test.com' }),
    ...overrides
  }
}

describe('PrismaAdapter — capabilities', () => {
  it('reports supportsCreateManyReturn=false by default', () => {
    const a = new PrismaAdapter({ delegate: makeDelegate() })
    expect(a.capabilities.supportsCreateManyReturn).toBe(false)
  })

  it('reports supportsCreateManyReturn=true when returnCreated=true', () => {
    const a = new PrismaAdapter({ delegate: makeDelegate(), returnCreated: true })
    expect(a.capabilities.supportsCreateManyReturn).toBe(true)
  })

  it('reports supportsIncludes=true always', () => {
    const a = new PrismaAdapter({ delegate: makeDelegate() })
    expect(a.capabilities.supportsIncludes).toBe(true)
  })
})

describe('PrismaAdapter — getOne', () => {
  it('delegates to findUnique with the id', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    const result = await a.getOne(1)
    expect(delegate.findUnique).toHaveBeenCalledWith({ where: { id: 1 } })
    expect(result).toMatchObject({ id: 1 })
  })

  it('falls back to findFirst when findUnique is absent', async () => {
    const delegate = makeDelegate()
    delete (delegate as Record<string, unknown>).findUnique
    const a = new PrismaAdapter({ delegate })
    const result = await a.getOne(1)
    expect(delegate.findFirst).toHaveBeenCalled()
    expect(result).toMatchObject({ id: 1 })
  })

  it('throws when neither findUnique nor findFirst exists', async () => {
    const delegate = makeDelegate()
    delete (delegate as Record<string, unknown>).findUnique
    delete (delegate as Record<string, unknown>).findFirst
    const a = new PrismaAdapter({ delegate })
    await expect(a.getOne(1)).rejects.toThrow('does not support findUnique or findFirst')
  })

  it('passes select when fields are specified', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    await a.getOne(1, { fields: ['id', 'email'] })
    expect(delegate.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { id: true, email: true }
    })
  })

  it('passes include when include is specified', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    await a.getOne(1, { include: ['posts'] })
    expect(delegate.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      include: { posts: true }
    })
  })

  it('uses a custom idField', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate, idField: 'uid' })
    await a.getOne('abc')
    expect(delegate.findUnique).toHaveBeenCalledWith({ where: { uid: 'abc' } })
  })
})

describe('PrismaAdapter — getMany', () => {
  it('returns count and results', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    const result = await a.getMany()
    expect(result.count).toBe(1)
    expect(result.results).toHaveLength(1)
  })

  it('passes orderBy, skip, take to findMany', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    await a.getMany({ limit: 10, offset: 5, orderBy: [{ field: 'email', direction: 'asc' }] })
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 5, orderBy: [{ email: 'asc' }] })
    )
  })

  it('passes select when fields are given', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    await a.getMany({ fields: ['id'] })
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true } })
    )
  })

  it('passes include when include is given', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    await a.getMany({ include: ['comments'] })
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { comments: true } })
    )
  })
})

describe('PrismaAdapter — createOne', () => {
  it('calls delegate.create and returns the record', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    const result = await a.createOne({ email: 'new@test.com' })
    expect(delegate.create).toHaveBeenCalledWith({ data: { email: 'new@test.com' } })
    expect(result).toMatchObject({ email: 'new@test.com' })
  })
})

describe('PrismaAdapter — createMany', () => {
  it('calls createMany on delegate and returns []', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    const result = await a.createMany([{ email: 'a@t.com' }, { email: 'b@t.com' }])
    expect(delegate.createMany).toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('falls back to serial createOne calls when delegate lacks createMany', async () => {
    const delegate = makeDelegate()
    delete (delegate as Record<string, unknown>).createMany
    const a = new PrismaAdapter({ delegate })
    const result = await a.createMany([{ email: 'a@t.com' }, { email: 'b@t.com' }])
    expect(delegate.create).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(2)
  })

  it('uses serial createOne when returnCreated=true even if createMany exists', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate, returnCreated: true })
    const result = await a.createMany([{ email: 'a@t.com' }])
    expect(delegate.create).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
  })
})

describe('PrismaAdapter — updateOne', () => {
  it('calls delegate.update and returns the updated record', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    const result = await a.updateOne(1, { email: 'updated@test.com' })
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { email: 'updated@test.com' }
    })
    expect(result).toMatchObject({ email: 'updated@test.com' })
  })

  it('returns null when Prisma throws P2025 (record not found)', async () => {
    const p2025 = Object.assign(new Error('Not found'), { code: 'P2025' })
    const delegate = makeDelegate({ update: vi.fn().mockRejectedValue(p2025) })
    const a = new PrismaAdapter({ delegate })
    expect(await a.updateOne(999, { email: 'x@t.com' })).toBeNull()
  })

  it('re-throws non-P2025 errors from update', async () => {
    const err = new Error('Connection lost')
    const delegate = makeDelegate({ update: vi.fn().mockRejectedValue(err) })
    const a = new PrismaAdapter({ delegate })
    await expect(a.updateOne(1, { email: 'x@t.com' })).rejects.toThrow('Connection lost')
  })
})

describe('PrismaAdapter — upsertOne', () => {
  it('calls delegate.upsert and returns the record', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    const result = await a.upsertOne(1, { email: 'upserted@test.com' } as Row)
    expect(delegate.upsert).toHaveBeenCalled()
    expect(result).toMatchObject({ email: 'upserted@test.com' })
  })

  it('throws 501 when delegate has no upsert method', async () => {
    const delegate = makeDelegate()
    delete (delegate as Record<string, unknown>).upsert
    const a = new PrismaAdapter({ delegate })
    await expect(a.upsertOne(1, { email: 'x@t.com' } as Row)).rejects.toMatchObject({ status: 501 })
  })
})

describe('PrismaAdapter — deleteOne', () => {
  it('returns true when delete succeeds', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate })
    expect(await a.deleteOne(1)).toBe(true)
  })

  it('returns false when Prisma throws P2025 (record not found)', async () => {
    const p2025 = Object.assign(new Error('Not found'), { code: 'P2025' })
    const delegate = makeDelegate({ delete: vi.fn().mockRejectedValue(p2025) })
    const a = new PrismaAdapter({ delegate })
    expect(await a.deleteOne(999)).toBe(false)
  })

  it('re-throws non-P2025 errors from delete', async () => {
    const err = new Error('Connection lost')
    const delegate = makeDelegate({ delete: vi.fn().mockRejectedValue(err) })
    const a = new PrismaAdapter({ delegate })
    await expect(a.deleteOne(1)).rejects.toThrow('Connection lost')
  })
})

describe('PrismaAdapter — updateMany (delegate)', () => {
  it('selects affected ids then bulk-updates via the delegate', async () => {
    const delegate = makeDelegate({
      findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      updateMany: vi.fn().mockResolvedValue({ count: 2 })
    })
    const a = new PrismaAdapter({ delegate })
    const result = await a.updateMany(
      {
        where: [{ field: 'id', comparison: SqlComparison.GreaterThan, value1: 0 }]
      },
      { email: 'new@test.com' } as Partial<Row>
    )
    expect(delegate.findMany).toHaveBeenCalledTimes(1)
    expect(delegate.updateMany).toHaveBeenCalledTimes(1)
    // The compiled where reaches Prisma; validation/4xx happens upstream in the router.
    expect(delegate.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: { gt: 0 } },
      data: { email: 'new@test.com' }
    })
    expect(result.updated).toEqual([1, 2])
  })

  it('throws 501 when the delegate does not support updateMany', async () => {
    const a = new PrismaAdapter({ delegate: makeDelegate({ updateMany: undefined }) })
    await expect(a.updateMany({}, {} as Partial<Row>)).rejects.toMatchObject({
      status: 501
    })
  })
})

describe('PrismaAdapter — deleteMany (delegate)', () => {
  it('selects affected ids then bulk-deletes via the delegate', async () => {
    const delegate = makeDelegate({
      findMany: vi.fn().mockResolvedValue([{ id: 5 }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    })
    const a = new PrismaAdapter({ delegate })
    const result = await a.deleteMany({
      where: [{ field: 'id', comparison: SqlComparison.Equal, value1: 5 }]
    })
    expect(delegate.deleteMany).toHaveBeenCalledTimes(1)
    expect(delegate.deleteMany.mock.calls[0]![0]).toMatchObject({ where: { id: { equals: 5 } } })
    expect(result.deleted).toEqual([5])
  })

  it('throws 501 when the delegate does not support deleteMany', async () => {
    const a = new PrismaAdapter({ delegate: makeDelegate({ deleteMany: undefined }) })
    await expect(a.deleteMany({})).rejects.toMatchObject({ status: 501 })
  })
})

describe('PrismaAdapter — executeQuery (delegate)', () => {
  it('returns count and results via the delegate (no raw SQL, no client needed)', async () => {
    const delegate = makeDelegate({
      count: vi.fn().mockResolvedValue(2),
      findMany: vi.fn().mockResolvedValue([
        { id: 1, email: 'a@t.com' },
        { id: 2, email: 'b@t.com' }
      ])
    })
    const a = new PrismaAdapter({ delegate })
    const result = await a.executeQuery({
      fields: ['id', 'email'],
      where: [{ field: 'email', comparison: SqlComparison.Contains, value1: '@t.com' }],
      orderBy: [{ field: 'id', order: 'DESC' as never }],
      limit: 10,
      offset: 0
    })
    expect(result.count).toBe(2)
    expect(result.results).toHaveLength(2)
    // The AST compiled to a portable Prisma findMany argument set.
    expect(delegate.findMany.mock.calls[0]![0]).toMatchObject({
      where: { email: { contains: '@t.com' } },
      select: { id: true, email: true },
      orderBy: [{ id: 'desc' }],
      take: 10,
      skip: 0
    })
  })

  it('works without a client (delegate-only)', async () => {
    const a = new PrismaAdapter({ delegate: makeDelegate({ count: vi.fn().mockResolvedValue(0) }) })
    const result = await a.executeQuery({})
    expect(result.count).toBe(0)
  })
})

describe('PrismaAdapter — schema introspection', () => {
  const model: ModelSchema = {
    fields: [
      { name: 'id', kind: 'scalar', isId: true, isReadOnly: false, hasDefault: true },
      { name: 'email', kind: 'scalar', isId: false, isReadOnly: false, hasDefault: false },
      { name: 'createdAt', kind: 'scalar', isId: false, isReadOnly: false, hasDefault: true },
      { name: 'authorId', kind: 'scalar', isId: false, isReadOnly: true, hasDefault: false },
      { name: 'author', kind: 'object', isId: false, isReadOnly: false, hasDefault: false },
      { name: 'posts', kind: 'object', isId: false, isReadOnly: false, hasDefault: false }
    ]
  }

  it('fieldsFromModel excludes relation fields', () => {
    const fields = PrismaAdapter.fieldsFromModel(model)
    expect(fields.map((f) => f.name)).toEqual(['id', 'email', 'createdAt', 'authorId'])
  })

  it('fieldsFromModel marks id and readOnly fields as non-writable', () => {
    const fields = PrismaAdapter.fieldsFromModel(model)
    const byName = Object.fromEntries(fields.map((f) => [f.name, f])) as Record<
      string,
      (typeof fields)[0]
    >
    expect(byName['id']!.writable).toBe(false)
    expect(byName['email']!.writable).toBe(true)
    expect(byName['createdAt']!.writable).toBe(true)
    expect(byName['authorId']!.writable).toBe(false)
  })

  it('fieldsFromModel sets filterable and sortable true for all scalar fields', () => {
    const fields = PrismaAdapter.fieldsFromModel(model)
    expect(fields.every((f) => f.filterable === true && f.sortable === true)).toBe(true)
  })

  it('relationsFromModel returns only relation fields as includable', () => {
    const relations = PrismaAdapter.relationsFromModel(model)
    expect(relations.map((r) => r.name)).toEqual(['author', 'posts'])
    expect(relations.every((r) => r.includable === true)).toBe(true)
  })

  it('populates fields and relations on the adapter when model is provided', () => {
    const a = new PrismaAdapter({ delegate: makeDelegate(), model })
    expect(a.fields).toHaveLength(4)
    expect(a.relations).toHaveLength(2)
  })

  it('leaves fields and relations undefined when no model is provided', () => {
    const a = new PrismaAdapter({ delegate: makeDelegate() })
    expect(a.fields).toBeUndefined()
    expect(a.relations).toBeUndefined()
  })
})

describe('toRoutePrefix', () => {
  it('lowercases and pluralises a simple PascalCase name', () => {
    expect(toRoutePrefix('User')).toBe('users')
  })

  it('converts camelCase segments to kebab-case and pluralises', () => {
    expect(toRoutePrefix('BlogPost')).toBe('blog-posts')
  })

  it('applies -ies rule for consonant-y endings', () => {
    expect(toRoutePrefix('Category')).toBe('categories')
    expect(toRoutePrefix('Body')).toBe('bodies')
    expect(toRoutePrefix('Activity')).toBe('activities')
  })

  it('adds -s (not -ies) for vowel-y endings', () => {
    expect(toRoutePrefix('Key')).toBe('keys')
    expect(toRoutePrefix('Monkey')).toBe('monkeys')
  })

  it('applies -es rule for names ending in s, x, z, ch, sh', () => {
    expect(toRoutePrefix('Status')).toBe('statuses')
    expect(toRoutePrefix('Tax')).toBe('taxes')
    expect(toRoutePrefix('Church')).toBe('churches')
  })

  it('handles a multi-word camelCase name', () => {
    expect(toRoutePrefix('UserProfile')).toBe('user-profiles')
    expect(toRoutePrefix('AuditLog')).toBe('audit-logs')
  })
})

describe('PrismaAdapter — scoped getOne', () => {
  it('uses findFirst with scoped where when scoped', async () => {
    const delegate = makeDelegate()
    const a = new PrismaAdapter({ delegate, scope: { field: 'tenantId', value: 'tenant-a' } })
    const result = await a.getOne(1)
    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 1, tenantId: 'tenant-a' }) })
    )
    expect(result).toMatchObject({ id: 1 })
  })

  it('throws ServerError when scoped and findFirst is absent', async () => {
    const delegate = makeDelegate()
    delete (delegate as Record<string, unknown>).findFirst
    const a = new PrismaAdapter({ delegate, scope: { field: 'tenantId', value: 'tenant-a' } })
    await expect(a.getOne(1)).rejects.toMatchObject({ status: 500 })
  })
})

describe('PrismaAdapter — scoped updateOne', () => {
  it('returns null when owned record is not in scope', async () => {
    const delegate = makeDelegate({ findFirst: vi.fn().mockResolvedValue(null) })
    const a = new PrismaAdapter({ delegate, scope: { field: 'tenantId', value: 'tenant-a' } })
    const result = await a.updateOne(1, { email: 'x@t.com' })
    expect(result).toBeNull()
    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 1, tenantId: 'tenant-a' })
      })
    )
    expect(delegate.update).not.toHaveBeenCalled()
  })

  it('throws ServerError when scoped but no findFirst', async () => {
    const delegate = makeDelegate()
    delete (delegate as Record<string, unknown>).findFirst
    const a = new PrismaAdapter({ delegate, scope: { field: 'tenantId', value: 'tenant-a' } })
    await expect(a.updateOne(1, { email: 'x@t.com' })).rejects.toMatchObject({ status: 500 })
  })
})

describe('PrismaAdapter — scoped upsertOne', () => {
  it('throws ServerError when scoped but no findFirst', async () => {
    const delegate = makeDelegate()
    delete (delegate as Record<string, unknown>).findFirst
    const a = new PrismaAdapter({ delegate, scope: { field: 'tenantId', value: 'tenant-a' } })
    await expect(a.upsertOne(1, { email: 'x@t.com' } as Row & { tenantId?: string })).rejects.toMatchObject({ status: 500 })
  })

  it('throws NotFoundError when existing row belongs to different tenant', async () => {
    const delegate = makeDelegate({
      findFirst: vi.fn().mockResolvedValue({ id: 1, email: 'a@t.com', tenantId: 'other-tenant' })
    })
    const a = new PrismaAdapter({ delegate, scope: { field: 'tenantId', value: 'tenant-a' } })
    await expect(a.upsertOne(1, { email: 'x@t.com' } as Row & { tenantId?: string })).rejects.toMatchObject({ status: 404 })
  })

  it('stamps tenant on create and strips it on update when scoped', async () => {
    const delegate = makeDelegate({
      findFirst: vi.fn().mockResolvedValue(null)
    })
    const a = new PrismaAdapter({ delegate, scope: { field: 'tenantId', value: 'tenant-a' } })
    await a.upsertOne(1, { email: 'x@t.com' } as Row & { tenantId?: string })
    expect(delegate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        create: expect.objectContaining({ tenantId: 'tenant-a', email: 'x@t.com' }),
        update: expect.not.objectContaining({ tenantId: expect.anything() })
      })
    )
  })
})

describe('PrismaAdapter — scoped deleteOne', () => {
  it('uses deleteMany for scoped delete when deleteMany is available', async () => {
    const delegate = makeDelegate({ deleteMany: vi.fn().mockResolvedValue({ count: 1 }) })
    const a = new PrismaAdapter({ delegate, scope: { field: 'tenantId', value: 'tenant-a' } })
    const result = await a.deleteOne(5)
    expect(result).toBe(true)
    expect(delegate.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 5, tenantId: 'tenant-a' })
      })
    )
  })

  it('throws ServerError when scoped but no deleteMany and no findFirst', async () => {
    const delegate = makeDelegate()
    delete (delegate as Record<string, unknown>).deleteMany
    delete (delegate as Record<string, unknown>).findFirst
    const a = new PrismaAdapter({ delegate, scope: { field: 'tenantId', value: 'tenant-a' } })
    await expect(a.deleteOne(1)).rejects.toMatchObject({ status: 500 })
  })

  it('uses findFirst when deleteMany is absent and returns false when not owned', async () => {
    const delegate = makeDelegate({ findFirst: vi.fn().mockResolvedValue(null) })
    delete (delegate as Record<string, unknown>).deleteMany
    const a = new PrismaAdapter({ delegate, scope: { field: 'tenantId', value: 'tenant-a' } })
    const result = await a.deleteOne(99)
    expect(result).toBe(false)
    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 99, tenantId: 'tenant-a' })
      })
    )
    expect(delegate.delete).not.toHaveBeenCalled()
  })
})

describe('createPrismaResources', () => {
  const userModel = {
    name: 'User',
    dbName: 'users',
    fields: [
      { name: 'id', kind: 'scalar', isId: true, isReadOnly: false, hasDefault: true },
      { name: 'email', kind: 'scalar', isId: false, isReadOnly: false, hasDefault: false },
      { name: 'posts', kind: 'object', isId: false, isReadOnly: false, hasDefault: false }
    ]
  }

  const blogPostModel = {
    name: 'BlogPost',
    dbName: 'blog_posts',
    fields: [
      { name: 'id', kind: 'scalar', isId: true, isReadOnly: false, hasDefault: true },
      { name: 'title', kind: 'scalar', isId: false, isReadOnly: false, hasDefault: false }
    ]
  }

  const auditLogModel = {
    name: 'AuditLog',
    dbName: 'audit_logs',
    fields: [{ name: 'id', kind: 'scalar', isId: true, isReadOnly: false, hasDefault: true }]
  }

  function makeClient() {
    return {
      user: makeDelegate(),
      blogPost: makeDelegate(),
      auditLog: makeDelegate(),
      $queryRawUnsafe: vi.fn()
    }
  }

  it('generates a resource for each model', () => {
    const resources = createPrismaResources(makeClient(), [userModel, blogPostModel])
    expect(resources).toHaveLength(2)
    expect(resources.map((r) => r.name)).toEqual(['User', 'BlogPost'])
  })

  it('derives routePrefix via kebab-case pluralisation', () => {
    const resources = createPrismaResources(makeClient(), [userModel, blogPostModel])
    expect(resources[0]!.routePrefix).toBe('users')
    expect(resources[1]!.routePrefix).toBe('blog-posts')
  })

  it('excludes models marked exclude: true', () => {
    const resources = createPrismaResources(
      makeClient(),
      [userModel, blogPostModel, auditLogModel],
      { models: { AuditLog: { exclude: true } } }
    )
    expect(resources.map((r) => r.name)).toEqual(['User', 'BlogPost'])
  })

  it('applies per-model permission overrides', () => {
    const resources = createPrismaResources(makeClient(), [userModel], {
      models: { User: { permissions: { allowDeleteOne: false, allowDeleteMany: false } } }
    })
    expect(resources[0]!.permissions?.allowDeleteOne).toBe(false)
    expect(resources[0]!.permissions?.allowDeleteMany).toBe(false)
    expect(resources[0]!.permissions?.allowCreate).toBeUndefined()
  })

  it('applies global permission overrides to all resources', () => {
    const resources = createPrismaResources(makeClient(), [userModel, blogPostModel], {
      permissions: { allowDeleteOne: false }
    })
    expect(resources[0]!.permissions?.allowDeleteOne).toBe(false)
    expect(resources[1]!.permissions?.allowDeleteOne).toBe(false)
  })

  it('per-model permissions override global permissions', () => {
    const resources = createPrismaResources(makeClient(), [userModel], {
      permissions: { allowDeleteOne: false },
      models: { User: { permissions: { allowDeleteOne: true } } }
    })
    expect(resources[0]!.permissions?.allowDeleteOne).toBe(true)
  })

  it('applies defaultLimit and maxLimit globally', () => {
    const resources = createPrismaResources(makeClient(), [userModel], {
      defaultLimit: 25,
      maxLimit: 100
    })
    expect(resources[0]!.defaultLimit).toBe(25)
    expect(resources[0]!.maxLimit).toBe(100)
  })

  it('per-model defaultLimit overrides global', () => {
    const resources = createPrismaResources(makeClient(), [userModel], {
      defaultLimit: 25,
      models: { User: { defaultLimit: 10 } }
    })
    expect(resources[0]!.defaultLimit).toBe(10)
  })

  it('allows per-model routePrefix override', () => {
    const resources = createPrismaResources(makeClient(), [userModel], {
      models: { User: { routePrefix: 'members' } }
    })
    expect(resources[0]!.routePrefix).toBe('members')
  })
})
