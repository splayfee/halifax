import { describe, expect, it } from 'vitest'
import { QueryBuilder } from '../../src/classes/QueryBuilder.js'
import { SqlComparison } from '../../src/enums/SqlComparison.js'
import { SqlOrder } from '../../src/enums/SqlOrder.js'

it('builds parameterized select queries', () => {
  const query = QueryBuilder.buildSelectQuery({
    tableName: 'Users',
    fields: ['id', 'email'],
    where: [
      {
        field: 'email',
        comparison: SqlComparison.Like,
        value1: '%@example.com'
      }
    ],
    orderBy: [{ field: 'id', order: SqlOrder.DESC }],
    limit: 10,
    offset: 20
  })

  expect(query.statement).toBe('SELECT id,email FROM Users WHERE email LIKE ? ORDER BY id DESC OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY')
  expect(query.parameters).toEqual(['%@example.com'])
})

describe('QueryBuilder', () => {
  it('builds update queries without updating id', () => {
    const query = QueryBuilder.buildUpdateQuery(
      {
        tableName: 'Users',
        where: [{ field: 'id', comparison: SqlComparison.Equal, value1: 7 }]
      },
      { id: 7, email: 'new@example.com' }
    )

    expect(query.statement).toBe('UPDATE Users SET email = ? WHERE id = ?')
    expect(query.parameters).toEqual(['new@example.com', 7])
  })
})
