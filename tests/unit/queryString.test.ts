import { describe, it, expect } from 'vitest'
import { parseListOptions } from '@/core/queryString.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'
import type { ResourceDefinition } from '@/core/types.js'

const resource: ResourceDefinition = {
  name: 'Post',
  routePrefix: 'posts',
  fields: [
    { name: 'id', filterable: true, sortable: true, selectable: true },
    { name: 'title', filterable: true, sortable: true, selectable: true },
    { name: 'secret', filterable: false, sortable: false, selectable: false }
  ],
  relations: [{ name: 'author', includable: true }],
  repository: null as never
}

describe('parseListOptions — defaults', () => {
  it('returns empty options for an empty query string', () => {
    const opts = parseListOptions({}, resource)
    expect(opts.fields).toBeUndefined()
    expect(opts.include).toBeUndefined()
    expect(opts.limit).toBeUndefined()
    expect(opts.offset).toBeUndefined()
    expect(opts.orderBy).toBeUndefined()
    expect(opts.where).toEqual({})
  })

  it('applies defaultLimit when limit is absent', () => {
    const opts = parseListOptions({}, { ...resource, defaultLimit: 25 })
    expect(opts.limit).toBe(25)
  })

  it('does not apply defaultLimit when limit is explicitly provided', () => {
    const opts = parseListOptions({ limit: '5' }, { ...resource, defaultLimit: 25 })
    expect(opts.limit).toBe(5)
  })

  it('caps limit at maxLimit', () => {
    const opts = parseListOptions({ limit: '200' }, { ...resource, maxLimit: 50 })
    expect(opts.limit).toBe(50)
  })

  it('does not cap limit when it is below maxLimit', () => {
    const opts = parseListOptions({ limit: '5' }, { ...resource, maxLimit: 100 })
    expect(opts.limit).toBe(5)
  })
})

describe('parseListOptions — limit and offset', () => {
  it('parses limit as an integer', () => {
    expect(parseListOptions({ limit: '10' }, resource).limit).toBe(10)
  })

  it('parses offset of 0', () => {
    expect(parseListOptions({ offset: '0' }, resource).offset).toBe(0)
  })

  it('parses offset greater than 0', () => {
    expect(parseListOptions({ offset: '5' }, resource).offset).toBe(5)
  })

  it('throws 422 for a non-numeric limit', () => {
    expect(() => parseListOptions({ limit: 'abc' }, resource)).toThrow(UnprocessableEntityError)
  })

  it('throws 422 for a negative limit', () => {
    expect(() => parseListOptions({ limit: '-1' }, resource)).toThrow(UnprocessableEntityError)
  })

  it('throws 422 for limit of zero', () => {
    expect(() => parseListOptions({ limit: '0' }, resource)).toThrow(UnprocessableEntityError)
  })
})

describe('parseListOptions — fields', () => {
  it('parses a comma-separated fields list', () => {
    const opts = parseListOptions({ fields: 'id,title' }, resource)
    expect(opts.fields).toEqual(['id', 'title'])
  })

  it('trims spaces in fields list', () => {
    const opts = parseListOptions({ fields: 'id, title' }, resource)
    expect(opts.fields).toEqual(['id', 'title'])
  })

  it('throws 422 for an unknown field in ?fields=', () => {
    expect(() => parseListOptions({ fields: 'nonexistent' }, resource)).toThrow(
      UnprocessableEntityError
    )
  })

  it('throws 422 for a non-selectable field in ?fields=', () => {
    expect(() => parseListOptions({ fields: 'secret' }, resource)).toThrow(UnprocessableEntityError)
  })
})

describe('parseListOptions — include', () => {
  it('parses a relation include', () => {
    const opts = parseListOptions({ include: 'author' }, resource)
    expect(opts.include).toEqual(['author'])
  })

  it('throws 422 when both ?fields= and ?include= are used together', () => {
    expect(() => parseListOptions({ fields: 'id', include: 'author' }, resource)).toThrow(
      UnprocessableEntityError
    )
  })

  it('throws 422 for an unknown relation name in ?include=', () => {
    expect(() => parseListOptions({ include: 'nonexistent' }, resource)).toThrow(
      UnprocessableEntityError
    )
  })
})

describe('parseListOptions — ordering', () => {
  it('parses ascending order (no prefix)', () => {
    const opts = parseListOptions({ order: 'title' }, resource)
    expect(opts.orderBy).toEqual([{ field: 'title', direction: 'asc' }])
  })

  it('parses descending order (- prefix)', () => {
    const opts = parseListOptions({ order: '-id' }, resource)
    expect(opts.orderBy).toEqual([{ field: 'id', direction: 'desc' }])
  })

  it('parses multiple sort fields', () => {
    const opts = parseListOptions({ order: 'title,-id' }, resource)
    expect(opts.orderBy).toEqual([
      { field: 'title', direction: 'asc' },
      { field: 'id', direction: 'desc' }
    ])
  })

  it('throws 422 for a non-sortable field in ?order=', () => {
    expect(() => parseListOptions({ order: 'secret' }, resource)).toThrow(UnprocessableEntityError)
  })

  it('throws 422 for an unknown field in ?order=', () => {
    expect(() => parseListOptions({ order: 'bogus' }, resource)).toThrow(UnprocessableEntityError)
  })
})

describe('parseListOptions — where clause construction', () => {
  it('builds a single-value where clause for a filterable field', () => {
    const opts = parseListOptions({ id: '1' }, resource)
    expect(opts.where).toEqual({ id: '1' })
  })

  it('builds an { in: [...] } clause for comma-separated field values', () => {
    const opts = parseListOptions({ id: '1,2,3' }, resource)
    expect(opts.where).toEqual({ id: { in: ['1', '2', '3'] } })
  })

  it('ignores reserved parameter names when building where clause', () => {
    const opts = parseListOptions({ limit: '10', offset: '0' }, resource)
    expect(opts.where).not.toHaveProperty('limit')
    expect(opts.where).not.toHaveProperty('offset')
  })

  it('throws 422 for a non-filterable field used as a query param', () => {
    expect(() => parseListOptions({ secret: 'x' }, resource)).toThrow(UnprocessableEntityError)
  })

  it('throws 422 for an unknown query-string property', () => {
    expect(() => parseListOptions({ bogus: 'x' }, resource)).toThrow(UnprocessableEntityError)
  })
})
