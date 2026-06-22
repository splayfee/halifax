import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { zodValidator } from '../../src/validators/zod.js'
import type { ValidationResult } from '../../src/interfaces/ISchemaValidator.js'

/** `validate` is synchronous for the Zod adapter; await to collapse the declared sync|async union. */
async function run<T>(
  validator: { validate(d: unknown): ValidationResult<T> | Promise<ValidationResult<T>> },
  data: unknown
) {
  return await validator.validate(data)
}

describe('zodValidator', () => {
  it('returns success with the parsed value for valid input', async () => {
    const validator = zodValidator(z.object({ name: z.string(), age: z.number() }))
    const result = await run(validator, { name: 'Ada', age: 36 })
    expect(result).toEqual({ success: true, value: { name: 'Ada', age: 36 } })
  })

  it('returns errors with dotted path and message for invalid input', async () => {
    const validator = zodValidator(z.object({ name: z.string() }))
    const result = await run(validator, { name: 123 })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.path).toBe('name')
    expect(result.errors[0]?.message).toEqual(expect.any(String))
    expect((result.errors[0]?.message ?? '').length).toBeGreaterThan(0)
  })

  it('joins nested object paths with dots', async () => {
    const validator = zodValidator(z.object({ address: z.object({ zip: z.string() }) }))
    const result = await run(validator, { address: { zip: 90210 } })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.errors[0]?.path).toBe('address.zip')
  })

  it('toJsonSchema returns an object with a type when supported, else undefined', () => {
    const validator = zodValidator(z.object({ name: z.string() }))
    const schema = validator.toJsonSchema?.()
    if (typeof z.toJSONSchema === 'function') {
      expect(schema).toBeTypeOf('object')
      expect(schema).toHaveProperty('type', 'object')
    } else {
      expect(schema).toBeUndefined()
    }
  })
})
