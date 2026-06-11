import { describe, it, expect, vi } from 'vitest'
import { PrismaAdapter, createPrismaResources } from '@/adapters/orm/prisma/index.js'
import { toRoutePrefix } from '@/adapters/orm/prisma/helpers.js'
import type { ModelSchema } from '@/core/types.js'
import { SqlComparison } from '@/enums/SqlComparison.js'

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

function makeClient(rows: Row[] = [{ id: 1, email: 'a@test.com' }]) {
  let call = 0
  return {
    $queryRawUnsafe: vi.fn().mockImplementation(() => {
      call++
      if (call === 1) return Promise.resolve([{ count: rows.length }])
      if (call === 2) return Promise.resolve(rows)
      return Promise.resolve(rows)
    })
  }
}

describe('PrismaAdapter — capabilities', () => {
  it('reports supportsNativeSql=true when client is provided', () => {
    const a = new PrismaAdapter({
      delegate: makeDelegate(),
      client: makeClient(),
      tableName: 't'
    })
    expect(a.capabilities.supportsNativeSql).toBe(true)
  })

  it('reports supportsNativeSql=false without a client', () => {
    const a = new PrismaAdapter({ delegate: makeDelegate() })
    expect(a.capabilities.supportsNativeSql).toBe(false)
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

describe('PrismaAdapter — updateMany (native SQL)', () => {
  it('runs a single UPDATE ... RETURNING and returns updated ids', async () => {
    const client = {
      $queryRawUnsafe: vi.fn().mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
    }
    const a = new PrismaAdapter({ delegate: makeDelegate(), client, tableName: 'users' })
    const result = await a.updateMany(
      { tableName: 'users', where: [{ field: 'id', comparison: SqlComparison.Equal, value1: 1 }] },
      { email: 'new@test.com' } as Partial<Row>
    )
    expect(client.$queryRawUnsafe).toHaveBeenCalledTimes(1)
    expect(result.updated).toEqual([1, 2])
  })

  it('throws 501 when no client is provided', async () => {
    const a = new PrismaAdapter({ delegate: makeDelegate(), tableName: 'users' })
    await expect(a.updateMany({ tableName: 'users' }, {} as Partial<Row>)).rejects.toMatchObject({
      status: 501
    })
  })

  it('throws 501 when no tableName is set', async () => {
    const a = new PrismaAdapter({
      delegate: makeDelegate(),
      client: { $queryRawUnsafe: vi.fn() }
    })
    await expect(a.updateMany({ tableName: 'users' }, {} as Partial<Row>)).rejects.toMatchObject({
      status: 501
    })
  })
})

describe('PrismaAdapter — deleteMany (native SQL)', () => {
  it('runs a single DELETE ... RETURNING and returns deleted ids', async () => {
    const client = {
      $queryRawUnsafe: vi.fn().mockResolvedValueOnce([{ id: 5 }])
    }
    const a = new PrismaAdapter({ delegate: makeDelegate(), client, tableName: 'users' })
    const result = await a.deleteMany({
      tableName: 'users',
      where: [{ field: 'id', comparison: SqlComparison.Equal, value1: 5 }]
    })
    expect(client.$queryRawUnsafe).toHaveBeenCalledTimes(1)
    expect(result.deleted).toEqual([5])
  })

  it('throws 501 when no client is provided', async () => {
    const a = new PrismaAdapter({ delegate: makeDelegate(), tableName: 'users' })
    await expect(a.deleteMany({ tableName: 'users' })).rejects.toMatchObject({ status: 501 })
  })
})

describe('PrismaAdapter — executeQueryBuilder (native SQL)', () => {
  it('returns count and results', async () => {
    const client = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([{ count: 2 }])
        .mockResolvedValueOnce([
          { id: 1, email: 'a@t.com' },
          { id: 2, email: 'b@t.com' }
        ])
    }
    const a = new PrismaAdapter({ delegate: makeDelegate(), client, tableName: 'users' })
    const result = await a.executeQueryBuilder({ tableName: 'users' })
    expect(result.count).toBe(2)
    expect(result.results).toHaveLength(2)
  })

  it('throws 501 when no client is provided', async () => {
    const a = new PrismaAdapter({ delegate: makeDelegate(), tableName: 'users' })
    await expect(a.executeQueryBuilder({ tableName: 'users' })).rejects.toMatchObject({
      status: 501
    })
  })

  it('coerces count to number from BigInt-like string', async () => {
    const client = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([{ count: '42' }])
        .mockResolvedValueOnce([])
    }
    const a = new PrismaAdapter({ delegate: makeDelegate(), client, tableName: 'users' })
    const result = await a.executeQueryBuilder({ tableName: 'users' })
    expect(result.count).toBe(42)
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

  it('uses dbName as tableName when available', () => {
    const resources = createPrismaResources(makeClient(), [userModel])
    expect(resources[0]!.tableName).toBe('users')
  })

  it('falls back to model name when dbName is absent', () => {
    const model = { name: 'User', fields: userModel.fields }
    const resources = createPrismaResources(makeClient(), [model])
    expect(resources[0]!.tableName).toBe('User')
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
