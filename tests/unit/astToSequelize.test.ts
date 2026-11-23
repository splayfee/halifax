import { describe, it, expect } from 'vitest'
import { Op } from 'sequelize'
import { astToSequelizeWhere } from '@/adapters/orm/sequelize/astToSequelize.js'
import { SqlComparison } from '@edium/halifax-types'

const FIELDS = new Set(['title'])

/** Compiles one filter on `title` for a dialect with or without `ILIKE`. */
function one(comparison: SqlComparison, value1: string, iLike: boolean): unknown {
  return astToSequelizeWhere([{ field: 'title', comparison, value1 }], FIELDS, iLike)
}

describe('astToSequelizeWhere — case-insensitive comparisons', () => {
  it('uses Op.iLike on PostgreSQL', () => {
    expect(one(SqlComparison.IContains, 'ab', true)).toEqual({ title: { [Op.iLike]: '%ab%' } })
    expect(one(SqlComparison.IStartsWith, 'ab', true)).toEqual({ title: { [Op.iLike]: 'ab%' } })
    expect(one(SqlComparison.IEndsWith, 'ab', true)).toEqual({ title: { [Op.iLike]: '%ab' } })
  })

  it('uses Op.like on dialects without ILIKE', () => {
    expect(one(SqlComparison.IContains, 'ab', false)).toEqual({ title: { [Op.like]: '%ab%' } })
    expect(one(SqlComparison.IStartsWith, 'ab', false)).toEqual({ title: { [Op.like]: 'ab%' } })
    expect(one(SqlComparison.IEndsWith, 'ab', false)).toEqual({ title: { [Op.like]: '%ab' } })
  })

  it('escapes LIKE metacharacters in the value', () => {
    expect(one(SqlComparison.IContains, '50%_off', true)).toEqual({
      title: { [Op.iLike]: '%50\\%\\_off%' }
    })
  })

  it('keeps CONTAINS on Op.like on PostgreSQL', () => {
    expect(one(SqlComparison.Contains, 'ab', true)).toEqual({ title: { [Op.like]: '%ab%' } })
  })
})
