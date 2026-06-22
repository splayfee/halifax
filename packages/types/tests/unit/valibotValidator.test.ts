import { describe, it, expect } from 'vitest'
import * as v from 'valibot'
import { valibotValidator } from '../../src/validators/valibot.js'

describe('valibotValidator', () => {
  it('returns success with the coerced output for valid input', () => {
    const schema = v.object({
      name: v.string(),
      age: v.number()
    })
    const validator = valibotValidator(schema)

    const result = validator.validate({ name: 'Ada', age: 36 })

    expect(result).toEqual({
      success: true,
      value: { name: 'Ada', age: 36 }
    })
  })

  it('returns failure with field errors carrying the dotted path and message', () => {
    const schema = v.object({
      name: v.string('name must be a string'),
      age: v.number('age must be a number')
    })
    const validator = valibotValidator(schema)

    const result = validator.validate({ name: 123, age: 'old' })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')

    expect(result.errors).toEqual(
      expect.arrayContaining([
        { path: 'name', message: 'name must be a string' },
        { path: 'age', message: 'age must be a number' }
      ])
    )
    expect(result.errors).toHaveLength(2)
  })

  it('derives a nested dotted path via getDotPath', () => {
    const schema = v.object({
      address: v.object({
        zip: v.string('zip must be a string')
      })
    })
    const validator = valibotValidator(schema)

    const result = validator.validate({ address: { zip: 90210 } })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')

    expect(result.errors).toEqual([{ path: 'address.zip', message: 'zip must be a string' }])
  })

  it('toJsonSchema() converts the schema structure (type, properties, required, pipe, enum)', () => {
    const schema = v.object({
      name: v.string(),
      age: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
      role: v.picklist(['admin', 'user'])
    })
    const validator = valibotValidator(schema)
    const json = validator.toJsonSchema?.() as {
      type?: string
      properties?: Record<string, { type?: string; minimum?: number; enum?: unknown[] }>
      required?: string[]
    }

    expect(json?.type).toBe('object')
    expect(json?.properties?.name?.type).toBe('string')
    // `age` is optional → not in required; its pipe yields integer + minimum 0.
    expect(json?.properties?.age?.type).toBe('integer')
    expect(json?.properties?.age?.minimum).toBe(0)
    expect(json?.properties?.role?.enum).toEqual(['admin', 'user'])
    expect(json?.required).toEqual(expect.arrayContaining(['name', 'role']))
    expect(json?.required).not.toContain('age')
  })
})
