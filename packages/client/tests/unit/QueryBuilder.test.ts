import { QueryBuilder, SqlComparison, SqlOperator, SqlOrder } from '@/QueryBuilder.js'

describe('QueryBuilder', () => {
  describe('build() — empty builder', () => {
    it('returns an empty object when nothing is configured', () => {
      expect(new QueryBuilder().build()).toEqual({})
    })
  })

  describe('where / and / or — simple conditions', () => {
    it('where() adds a single filter with field and comparison', () => {
      const result = new QueryBuilder().where('name', SqlComparison.Equal, 'alice').build()
      expect(result.where).toHaveLength(1)
      expect(result.where![0]).toMatchObject({
        field: 'name',
        comparison: SqlComparison.Equal,
        value1: 'alice'
      })
    })

    it('where() with value2 (BETWEEN) includes both values', () => {
      const result = new QueryBuilder().where('age', SqlComparison.Between, 18, 30).build()
      expect(result.where![0]).toMatchObject({ value1: 18, value2: 30 })
    })

    it('where() with no values omits value1 and value2', () => {
      const result = new QueryBuilder().where('deleted', SqlComparison.IsNull).build()
      const filter = result.where![0]!
      expect('value1' in filter).toBe(false)
      expect('value2' in filter).toBe(false)
    })

    it('where() with array value1 (IN) stores the array', () => {
      const result = new QueryBuilder().where('status', SqlComparison.In, ['a', 'b']).build()
      expect(result.where![0]!.value1).toEqual(['a', 'b'])
    })

    it('and() sets AND operator on previous filter and adds a new one', () => {
      const result = new QueryBuilder()
        .where('a', SqlComparison.Equal, 1)
        .and('b', SqlComparison.Equal, 2)
        .build()
      expect(result.where).toHaveLength(2)
      expect(result.where![0]!.operator).toBe(SqlOperator.And)
      expect(result.where![1]!.operator).toBeUndefined()
    })

    it('or() sets OR operator on previous filter and adds a new one', () => {
      const result = new QueryBuilder()
        .where('a', SqlComparison.Equal, 1)
        .or('b', SqlComparison.Equal, 2)
        .build()
      expect(result.where![0]!.operator).toBe(SqlOperator.Or)
      expect(result.where![1]!.operator).toBeUndefined()
    })

    it('chains where().and().and() — first two get AND operator', () => {
      const result = new QueryBuilder()
        .where('a', SqlComparison.Equal, 1)
        .and('b', SqlComparison.Equal, 2)
        .and('c', SqlComparison.Equal, 3)
        .build()
      expect(result.where).toHaveLength(3)
      expect(result.where![0]!.operator).toBe(SqlOperator.And)
      expect(result.where![1]!.operator).toBe(SqlOperator.And)
      expect(result.where![2]!.operator).toBeUndefined()
    })

    it('chains where().and().or() — mixed operators', () => {
      const result = new QueryBuilder()
        .where('a', SqlComparison.Equal, 1)
        .and('b', SqlComparison.Equal, 2)
        .or('c', SqlComparison.Equal, 3)
        .build()
      expect(result.where![0]!.operator).toBe(SqlOperator.And)
      expect(result.where![1]!.operator).toBe(SqlOperator.Or)
    })

    it('and() with no previous filter (first call) does not crash', () => {
      // and() on an empty builder: _last is undefined, so no operator is set on anything
      const result = new QueryBuilder().and('x', SqlComparison.Equal, 1).build()
      expect(result.where).toHaveLength(1)
      expect(result.where![0]!.operator).toBeUndefined()
    })
  })

  describe('andGroup / orGroup — nested conditions', () => {
    it('andGroup() creates a parent filter with children and AND group operator', () => {
      const result = new QueryBuilder()
        .where('type', SqlComparison.Equal, 'post')
        .andGroup('role', SqlComparison.Equal, 'admin', (b) => {
          b.or('role', SqlComparison.Equal, 'user')
        })
        .build()

      expect(result.where).toHaveLength(2)
      const group = result.where![1]!
      expect(group.field).toBe('role')
      expect(group.operator).toBe(SqlOperator.And)
      // fn added 1 child filter; the parent field/value live on the group filter itself
      expect(group.children).toHaveLength(1)
    })

    it('andGroup() sets AND operator on the preceding filter', () => {
      const result = new QueryBuilder()
        .where('a', SqlComparison.Equal, 1)
        .andGroup('b', SqlComparison.Equal, 2, () => {})
        .build()
      expect(result.where![0]!.operator).toBe(SqlOperator.And)
    })

    it('orGroup() creates a parent filter with children and OR group operator', () => {
      const result = new QueryBuilder()
        .where('type', SqlComparison.Equal, 'post')
        .orGroup('name', SqlComparison.Contains, 'foo', (b) => {
          b.or('body', SqlComparison.Contains, 'foo')
        })
        .build()

      const group = result.where![1]!
      expect(group.operator).toBe(SqlOperator.Or)
      expect(group.children).toHaveLength(1)
    })

    it('andGroup() with no preceding filter does not crash', () => {
      const result = new QueryBuilder().andGroup('x', SqlComparison.Equal, 1, () => {}).build()
      expect(result.where).toHaveLength(1)
    })

    it('andGroup() with undefined value1 omits value1 from the filter', () => {
      const result = new QueryBuilder()
        .andGroup('x', SqlComparison.IsNull, undefined, () => {})
        .build()
      const filter = result.where![0]!
      expect('value1' in filter).toBe(false)
    })
  })

  describe('pagination, sorting, projection', () => {
    it('limit() sets the limit', () => {
      expect(new QueryBuilder().limit(10).build().limit).toBe(10)
    })

    it('offset() sets the offset', () => {
      expect(new QueryBuilder().offset(5).build().offset).toBe(5)
    })

    it('orderBy() defaults to ASC', () => {
      const result = new QueryBuilder().orderBy('name').build()
      expect(result.orderBy).toEqual([{ field: 'name', order: SqlOrder.ASC }])
    })

    it('orderBy() with explicit DESC', () => {
      const result = new QueryBuilder().orderBy('createdAt', SqlOrder.DESC).build()
      expect(result.orderBy![0]).toMatchObject({ field: 'createdAt', order: SqlOrder.DESC })
    })

    it('multiple orderBy() calls accumulate', () => {
      const result = new QueryBuilder().orderBy('name').orderBy('createdAt', SqlOrder.DESC).build()
      expect(result.orderBy).toHaveLength(2)
    })

    it('select() sets the fields projection', () => {
      const result = new QueryBuilder().select('id', 'name').build()
      expect(result.fields).toEqual(['id', 'name'])
    })

    it('distinct() sets the distinct fields', () => {
      const result = new QueryBuilder().distinct('email').build()
      expect(result.distinct).toEqual(['email'])
    })
  })

  describe('build() output immutability', () => {
    it('mutating the where array on build output does not affect the builder', () => {
      const qb = new QueryBuilder().where('a', SqlComparison.Equal, 1)
      const result = qb.build()
      result.where!.push({ field: 'b', comparison: SqlComparison.Equal })
      expect(qb.build().where).toHaveLength(1)
    })
  })

  describe('fluent interface', () => {
    it('all methods return the same builder instance', () => {
      const qb = new QueryBuilder()
      expect(qb.where('a', '=')).toBe(qb)
      expect(qb.and('b', '=')).toBe(qb)
      expect(qb.or('c', '=')).toBe(qb)
      expect(qb.limit(10)).toBe(qb)
      expect(qb.offset(0)).toBe(qb)
      expect(qb.orderBy('x')).toBe(qb)
      expect(qb.select('id')).toBe(qb)
      expect(qb.distinct('name')).toBe(qb)
    })
  })

  describe('re-exports', () => {
    it('re-exports SqlComparison, SqlOperator, SqlOrder', () => {
      expect(SqlComparison.Equal).toBeDefined()
      expect(SqlOperator.And).toBeDefined()
      expect(SqlOrder.ASC).toBeDefined()
    })
  })
})
