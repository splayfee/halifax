import { describe, expect, it } from 'vitest'
import { QueryBuilder } from '@/classes/QueryBuilder.js'
import { SqlComparison } from '@/enums/SqlComparison.js'
import { SqlOrder } from '@/enums/SqlOrder.js'

describe('QueryBuilder.buildSelectQuery', () => {
  it('builds a full select: fields, LIKE filter, sort, and pagination', () => {
    const q = QueryBuilder.buildSelectQuery({
      tableName: 'users',
      fields: ['id', 'email'],
      where: [{ field: 'email', comparison: SqlComparison.Like, value1: '%@example.com' }],
      orderBy: [{ field: 'id', order: SqlOrder.DESC }],
      limit: 10,
      offset: 20
    })
    expect(q.statement).toBe(
      'SELECT id,email FROM users WHERE email LIKE $1 ORDER BY id DESC OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY'
    )
    expect(q.parameters).toEqual(['%@example.com'])
  })

  it('selects * when fields is omitted', () => {
    const { statement } = QueryBuilder.buildSelectQuery({ tableName: 'posts' })
    expect(statement).toMatch(/^SELECT \* FROM posts/)
  })

  it('omits ORDER BY when orderBy is absent', () => {
    const { statement } = QueryBuilder.buildSelectQuery({ tableName: 'posts' })
    expect(statement).not.toContain('ORDER BY')
  })

  it('omits OFFSET/FETCH when limit is not set', () => {
    const { statement } = QueryBuilder.buildSelectQuery({ tableName: 'posts' })
    expect(statement).not.toContain('OFFSET')
    expect(statement).not.toContain('FETCH')
  })

  it('handles IS NULL with no parameter', () => {
    const { statement, parameters } = QueryBuilder.buildSelectQuery({
      tableName: 'posts',
      where: [{ field: 'deletedAt', comparison: SqlComparison.IsNull }]
    })
    expect(statement).toContain('deletedAt IS NULL')
    expect(parameters).toHaveLength(0)
  })

  it('handles IS NOT NULL with no parameter', () => {
    const { statement } = QueryBuilder.buildSelectQuery({
      tableName: 'posts',
      where: [{ field: 'deletedAt', comparison: SqlComparison.IsNotNull }]
    })
    expect(statement).toContain('deletedAt IS NOT NULL')
  })

  it('numbers multiple parameters in order', () => {
    const { statement, parameters } = QueryBuilder.buildSelectQuery({
      tableName: 'posts',
      where: [
        { field: 'published', comparison: SqlComparison.Equal, value1: true, operator: 'AND' },
        { field: 'authorId', comparison: SqlComparison.Equal, value1: 5 }
      ]
    })
    expect(statement).toContain('published = $1')
    expect(statement).toContain('AND')
    expect(statement).toContain('authorId = $2')
    expect(parameters).toEqual([true, 5])
  })

  it('handles BETWEEN with two parameters', () => {
    const { statement, parameters } = QueryBuilder.buildSelectQuery({
      tableName: 'events',
      where: [{ field: 'score', comparison: SqlComparison.Between, value1: 10, value2: 20 }]
    })
    expect(statement).toContain('score BETWEEN $1 AND $2')
    expect(parameters).toEqual([10, 20])
  })

  it('handles IN with array parameter', () => {
    const { statement, parameters } = QueryBuilder.buildSelectQuery({
      tableName: 'posts',
      where: [{ field: 'id', comparison: SqlComparison.In, value1: [1, 2, 3] }]
    })
    expect(statement).toContain('id IN ($1,$2,$3)')
    expect(parameters).toEqual([1, 2, 3])
  })

  it('handles DISTINCT', () => {
    const { statement } = QueryBuilder.buildSelectQuery({
      tableName: 'posts',
      isDistinct: true,
      fields: ['authorId']
    })
    expect(statement).toMatch(/^SELECT DISTINCT authorId/)
  })
})

describe('QueryBuilder.buildCountQuery', () => {
  it('builds a count with a where clause', () => {
    const { statement, parameters } = QueryBuilder.buildCountQuery({
      tableName: 'users',
      where: [{ field: 'active', comparison: SqlComparison.Equal, value1: true }]
    })
    expect(statement).toBe('SELECT COUNT(*) AS count FROM users WHERE active = $1')
    expect(parameters).toEqual([true])
  })

  it('builds a count with no where clause', () => {
    const { statement } = QueryBuilder.buildCountQuery({ tableName: 'users' })
    expect(statement).toBe('SELECT COUNT(*) AS count FROM users')
  })

  it('does not include ORDER BY', () => {
    const { statement } = QueryBuilder.buildCountQuery({ tableName: 'users' })
    expect(statement).not.toContain('ORDER BY')
  })
})

describe('QueryBuilder.buildUpdateQuery', () => {
  it('builds an update and excludes id from the SET clause', () => {
    const { statement, parameters } = QueryBuilder.buildUpdateQuery(
      { tableName: 'users', where: [{ field: 'id', comparison: SqlComparison.Equal, value1: 7 }] },
      { id: 7, email: 'new@example.com' }
    )
    expect(statement).toBe('UPDATE users SET email = $1 WHERE id = $2')
    expect(parameters).toEqual(['new@example.com', 7])
  })

  it('handles multiple SET fields', () => {
    const { statement, parameters } = QueryBuilder.buildUpdateQuery(
      { tableName: 'posts', where: [{ field: 'id', comparison: SqlComparison.Equal, value1: 1 }] },
      { title: 'New title', published: true }
    )
    // parameter order is Object.keys order; just verify all pieces are present
    expect(statement).toContain('UPDATE posts SET')
    expect(statement).toContain('WHERE id =')
    expect(parameters).toContain('New title')
    expect(parameters).toContain(true)
    expect(parameters).toContain(1)
  })
})

describe('QueryBuilder.buildDeleteQuery', () => {
  it('builds a delete with a where clause', () => {
    const { statement, parameters } = QueryBuilder.buildDeleteQuery({
      tableName: 'sessions',
      where: [{ field: 'userId', comparison: SqlComparison.Equal, value1: 42 }]
    })
    expect(statement).toBe('DELETE FROM sessions WHERE userId = $1')
    expect(parameters).toEqual([42])
  })

  it('builds a delete without a where clause', () => {
    const { statement } = QueryBuilder.buildDeleteQuery({ tableName: 'sessions' })
    expect(statement).toBe('DELETE FROM sessions')
  })
})

describe('QueryBuilder — edge cases', () => {
  it('throws BadRequestError when tableName is missing', () => {
    expect(() => QueryBuilder.buildSelectQuery({})).toThrow('table name')
  })

  it('handles LIKE comparison', () => {
    const { statement } = QueryBuilder.buildSelectQuery({
      tableName: 't',
      where: [{ field: 'name', comparison: SqlComparison.Like, value1: '%foo%' }]
    })
    expect(statement).toContain('name LIKE $1')
  })

  it('handles NOT LIKE comparison', () => {
    const { statement } = QueryBuilder.buildSelectQuery({
      tableName: 't',
      where: [{ field: 'name', comparison: SqlComparison.NotLike, value1: '%foo%' }]
    })
    expect(statement).toContain('name NOT LIKE $1')
  })

  it('handles NOT IN comparison', () => {
    const { statement, parameters } = QueryBuilder.buildSelectQuery({
      tableName: 't',
      where: [{ field: 'id', comparison: SqlComparison.NotIn, value1: [10, 20] }]
    })
    expect(statement).toContain('id NOT IN ($1,$2)')
    expect(parameters).toEqual([10, 20])
  })

  it('handles NOT BETWEEN comparison', () => {
    const { statement, parameters } = QueryBuilder.buildSelectQuery({
      tableName: 't',
      where: [{ field: 'score', comparison: SqlComparison.NotBetween, value1: 1, value2: 5 }]
    })
    expect(statement).toContain('score NOT BETWEEN $1 AND $2')
    expect(parameters).toEqual([1, 5])
  })

  it('includes value2 in parameters for BETWEEN', () => {
    const { parameters } = QueryBuilder.buildSelectQuery({
      tableName: 't',
      where: [{ field: 'score', comparison: SqlComparison.Between, value1: 10, value2: 20 }]
    })
    expect(parameters).toEqual([10, 20])
  })

  it('handles nested children filters', () => {
    const { statement } = QueryBuilder.buildSelectQuery({
      tableName: 't',
      where: [
        {
          field: 'id',
          comparison: SqlComparison.Equal,
          value1: 1,
          operator: 'AND',
          children: [{ field: 'id', comparison: SqlComparison.GreaterThan, value1: 0 }]
        }
      ]
    })
    expect(statement).toContain('(id > $2)')
  })

  it('builds DISTINCT count query', () => {
    const { statement } = QueryBuilder.buildCountQuery({ tableName: 'posts', isDistinct: true })
    expect(statement).toBe('SELECT DISTINCT COUNT(*) AS count FROM posts')
  })

  it('uses offset 0 when limit is set but offset is omitted', () => {
    const { statement } = QueryBuilder.buildSelectQuery({ tableName: 'posts', limit: 5 })
    expect(statement).toContain('OFFSET 0 ROWS')
    expect(statement).toContain('FETCH NEXT 5 ROWS ONLY')
  })
})
