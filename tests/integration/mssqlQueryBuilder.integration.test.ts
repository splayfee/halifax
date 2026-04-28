import { describe, expect, it } from 'vitest'
import { QueryBuilder, SqlComparison, SqlOrder } from '../../src/index.js'

describe('SQL Server query-builder integration placeholder', () => {
  it('emits SQL Server pagination syntax used by the MSSQL integration path', () => {
    const query = QueryBuilder.buildSelectQuery({
      tableName: 'Users',
      fields: ['id', 'email'],
      where: [{ field: 'email', comparison: SqlComparison.Like, value1: '%@example.com' }],
      orderBy: [{ field: 'id', order: SqlOrder.ASC }],
      limit: 25,
      offset: 0
    })

    expect(query.statement).toContain('OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY')
  })
})
