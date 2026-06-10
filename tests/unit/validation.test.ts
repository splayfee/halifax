import { describe, it, expect } from 'vitest'
import {
  validateWhere,
  validateAdvancedQuery,
  validateIncludes,
  validateSortableFields,
  validateSelectableFields,
  validateFields,
  getFieldNames
} from '@/core/validation.js'
import { SqlComparison } from '@/enums/SqlComparison.js'
import { SqlOrder } from '@/enums/SqlOrder.js'
import { ServerError } from '@/errors/ServerError.js'
import { PayloadError } from '@/errors/PayloadError.js'
import type { ResourceDefinition } from '@/core/types.js'

const resource: ResourceDefinition = {
  name: 'Post',
  routePrefix: 'posts',
  fields: [
    { name: 'id', filterable: true, sortable: true, selectable: true },
    { name: 'title', filterable: true, sortable: true, selectable: true },
    { name: 'secret', filterable: false, sortable: false, selectable: false }
  ],
  relations: [
    { name: 'author', includable: true },
    { name: 'hidden', includable: false }
  ],
  repository: null as never
}

describe('getFieldNames', () => {
  it('returns all field names', () => {
    expect(getFieldNames(resource)).toEqual(['id', 'title', 'secret'])
  })
})

describe('validateFields', () => {
  it('passes for valid fields', () => {
    expect(() => validateFields(resource, ['id', 'title'])).not.toThrow()
  })

  it('throws PayloadError for unknown fields', () => {
    expect(() => validateFields(resource, ['nonexistent'])).toThrow(PayloadError)
  })
})

describe('validateSelectableFields', () => {
  it('passes for selectable fields', () => {
    expect(() => validateSelectableFields(resource, ['id', 'title'])).not.toThrow()
  })

  it('throws for non-selectable fields', () => {
    expect(() => validateSelectableFields(resource, ['secret'])).toThrow(PayloadError)
  })
})

describe('validateSortableFields', () => {
  it('passes for sortable fields', () => {
    expect(() => validateSortableFields(resource, ['id', 'title'])).not.toThrow()
  })

  it('throws PayloadError for non-sortable fields', () => {
    expect(() => validateSortableFields(resource, ['secret'])).toThrow(PayloadError)
  })
})

describe('validateIncludes', () => {
  it('passes for valid includable relations', () => {
    expect(() => validateIncludes(resource, ['author'])).not.toThrow()
  })

  it('throws for relations with includable=false', () => {
    expect(() => validateIncludes(resource, ['hidden'])).toThrow(PayloadError)
  })

  it('throws for unknown relation names', () => {
    expect(() => validateIncludes(resource, ['unknown'])).toThrow(PayloadError)
  })

  it('passes when includes is empty array', () => {
    expect(() => validateIncludes(resource, [])).not.toThrow()
  })

  it('passes when includes is undefined', () => {
    expect(() => validateIncludes(resource, undefined)).not.toThrow()
  })
})

describe('validateWhere', () => {
  it('passes for a valid equal filter', () => {
    expect(() =>
      validateWhere(resource, [{ field: 'id', comparison: SqlComparison.Equal, value1: 1 }])
    ).not.toThrow()
  })

  it('throws when field is missing', () => {
    expect(() => validateWhere(resource, [{ field: '', comparison: SqlComparison.Equal }])).toThrow(
      'must have a field'
    )
  })

  it('throws for an unknown field', () => {
    expect(() =>
      validateWhere(resource, [{ field: 'bogus', comparison: SqlComparison.Equal }])
    ).toThrow(PayloadError)
  })

  it('throws for an invalid comparison', () => {
    expect(() => validateWhere(resource, [{ field: 'id', comparison: 'BADOP' }])).toThrow(
      'Invalid comparison'
    )
  })

  it('throws for an invalid operator', () => {
    expect(() =>
      validateWhere(resource, [
        { field: 'id', comparison: SqlComparison.Equal, value1: 1, operator: 'XOR' },
        { field: 'title', comparison: SqlComparison.Equal, value1: 'x' }
      ])
    ).toThrow('Invalid operator')
  })

  it('throws when operator is missing on a non-last item', () => {
    expect(() =>
      validateWhere(resource, [
        { field: 'id', comparison: SqlComparison.Equal, value1: 1 },
        { field: 'title', comparison: SqlComparison.Equal, value1: 'x' }
      ])
    ).toThrow('Operator is required')
  })

  it('allows the last filter to omit operator', () => {
    expect(() =>
      validateWhere(resource, [
        { field: 'id', comparison: SqlComparison.Equal, value1: 1, operator: 'AND' },
        { field: 'title', comparison: SqlComparison.Equal, value1: 'x' }
      ])
    ).not.toThrow()
  })

  it('recurses into children', () => {
    expect(() =>
      validateWhere(resource, [
        {
          field: 'id',
          comparison: SqlComparison.Equal,
          value1: 1,
          children: [{ field: 'bogus', comparison: SqlComparison.Equal }]
        }
      ])
    ).toThrow(PayloadError)
  })

  it('passes for empty array', () => {
    expect(() => validateWhere(resource, [])).not.toThrow()
  })

  it('passes for all comparison types', () => {
    const comparisons = [
      SqlComparison.Between,
      SqlComparison.NotBetween,
      SqlComparison.Like,
      SqlComparison.NotLike,
      SqlComparison.IsNull,
      SqlComparison.IsNotNull,
      SqlComparison.In,
      SqlComparison.NotIn,
      SqlComparison.GreaterThan,
      SqlComparison.GreaterThanOrEqual,
      SqlComparison.LessThan,
      SqlComparison.LessThanOrEqual,
      SqlComparison.NotEqual
    ]
    for (const comparison of comparisons) {
      expect(() => validateWhere(resource, [{ field: 'id', comparison }])).not.toThrow()
    }
  })
})

describe('validateAdvancedQuery', () => {
  it('passes for an empty query', () => {
    expect(() => validateAdvancedQuery(resource, { tableName: 'posts' })).not.toThrow()
  })

  it('validates fields selection', () => {
    expect(() =>
      validateAdvancedQuery(resource, { tableName: 'posts', fields: ['nonexistent'] })
    ).toThrow(PayloadError)
  })

  it('validates orderBy fields', () => {
    expect(() =>
      validateAdvancedQuery(resource, {
        tableName: 'posts',
        orderBy: [{ field: 'nonexistent', order: SqlOrder.ASC }]
      })
    ).toThrow(PayloadError)
  })

  it('throws for an invalid sort order value', () => {
    expect(() =>
      validateAdvancedQuery(resource, {
        tableName: 'posts',
        orderBy: [{ field: 'id', order: 'SIDEWAYS' as SqlOrder }]
      })
    ).toThrow('Invalid sort order')
  })

  it('validates where clause', () => {
    expect(() =>
      validateAdvancedQuery(resource, {
        tableName: 'posts',
        where: [{ field: 'id', comparison: 'INVALID' }]
      })
    ).toThrow(PayloadError)
  })

  it('validates non-sortable fields in orderBy', () => {
    expect(() =>
      validateAdvancedQuery(resource, {
        tableName: 'posts',
        orderBy: [{ field: 'secret', order: SqlOrder.ASC }]
      })
    ).toThrow(PayloadError)
  })
})

describe('ServerError', () => {
  it('creates a 500 error with the given message', () => {
    const err = new ServerError('something broke')
    expect(err.status).toBe(500)
    expect(err.message).toBe('something broke')
    expect(err.name).toBe('ServerError')
  })

  it('uses the default message when none is provided', () => {
    const err = new ServerError()
    expect(err.message).toBe('Server error')
    expect(err.status).toBe(500)
  })
})
