import { describe, it, expect } from 'vitest'
import { assertSafeRoutineName, quoteRoutineName, placeholders } from '@/core/sqlIdentifier.js'
import { ServerError } from '@/errors/ServerError.js'

describe('assertSafeRoutineName', () => {
  it('accepts a plain identifier', () => {
    expect(assertSafeRoutineName('report_summary')).toEqual(['report_summary'])
  })

  it('accepts a schema-qualified identifier', () => {
    expect(assertSafeRoutineName('analytics.report_summary')).toEqual([
      'analytics',
      'report_summary'
    ])
  })

  it.each([
    'drop table users',
    'report();--',
    'schema.proc.extra',
    '1bad',
    'name)',
    '"quoted"',
    ''
  ])('rejects unsafe name %j', (name) => {
    expect(() => assertSafeRoutineName(name)).toThrow(ServerError)
  })
})

describe('quoteRoutineName', () => {
  it('double-quotes each segment for postgres', () => {
    expect(quoteRoutineName('analytics.report_summary', 'postgres')).toBe(
      '"analytics"."report_summary"'
    )
  })

  it('back-ticks each segment for mysql', () => {
    expect(quoteRoutineName('report_summary', 'mysql')).toBe('`report_summary`')
  })

  it('bracket-quotes each segment for mssql', () => {
    expect(quoteRoutineName('dbo.report_summary', 'mssql')).toBe('[dbo].[report_summary]')
  })

  it('rejects an unsafe name before quoting', () => {
    expect(() => quoteRoutineName('a"; DROP', 'postgres')).toThrow(ServerError)
  })
})

describe('placeholders', () => {
  it('builds positional $n placeholders for postgres', () => {
    expect(placeholders(3, 'postgres')).toBe('$1, $2, $3')
  })

  it('builds ? placeholders for mysql', () => {
    expect(placeholders(2, 'mysql')).toBe('?, ?')
  })

  it('builds @Pn placeholders for mssql', () => {
    expect(placeholders(3, 'mssql')).toBe('@P1, @P2, @P3')
  })

  it('returns an empty string for zero params', () => {
    expect(placeholders(0, 'postgres')).toBe('')
  })
})
