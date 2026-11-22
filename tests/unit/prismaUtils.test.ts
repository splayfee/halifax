import { describe, expect, it } from 'vitest'
import { isIdentityInsertError } from '@/adapters/orm/prisma/prismaUtils.js'

describe('isIdentityInsertError', () => {
  it('recognises the SQL Server error where Prisma 7.8 and earlier put it (cause)', () => {
    expect(isIdentityInsertError({ cause: { code: 544 } })).toBe(true)
  })

  it('recognises the SQL Server error where Prisma 7.10 puts it (P2039 meta.driverAdapterError)', () => {
    const error = {
      code: 'P2039',
      meta: {
        driverAdapterError: { name: 'DriverAdapterError', cause: { kind: 'mssql', code: 544 } }
      }
    }
    expect(isIdentityInsertError(error)).toBe(true)
  })

  it('ignores other errors and non-objects', () => {
    expect(isIdentityInsertError({ cause: { code: 2627 } })).toBe(false)
    expect(isIdentityInsertError({ code: 'P2039', meta: {} })).toBe(false)
    expect(isIdentityInsertError(null)).toBe(false)
    expect(isIdentityInsertError('544')).toBe(false)
  })
})
