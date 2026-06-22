import { describe, it, expect } from 'vitest'
import * as yup from 'yup'
import { yupValidator } from '../../src/validators/yup.js'

const userSchema = yup.object({
  name: yup.string().required(),
  age: yup.number().required().min(0)
})

describe('yupValidator', () => {
  it('returns success with the coerced, stripped value for valid input', async () => {
    const validator = yupValidator(userSchema)

    // `age` is a numeric string (coerced to number) and `extra` is unknown (stripped).
    const result = await validator.validate({ name: 'Ada', age: '36', extra: 'drop me' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.value).toEqual({ name: 'Ada', age: 36 })
      expect(result.value).not.toHaveProperty('extra')
    }
  })

  it('returns failure with the right path and message for invalid input', async () => {
    const validator = yupValidator(userSchema)

    const result = await validator.validate({ name: 'Ada', age: -5 })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors).toHaveLength(1)
      const [error] = result.errors
      expect(error?.path).toBe('age')
      expect(error?.message).toMatch(/greater than or equal to 0/i)
    }
  })

  it('collects every failing field when abortEarly is false', async () => {
    const validator = yupValidator(userSchema)

    // Both fields are missing/invalid: `name` required, `age` required.
    const result = await validator.validate({})

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors).toHaveLength(2)
      const paths = result.errors.map((e) => e.path).sort()
      expect(paths).toEqual(['age', 'name'])
      for (const error of result.errors) {
        expect(error.message).toBeTruthy()
      }
    }
  })

  it('uses the empty-string path for a root-level error', async () => {
    // A top-level mixed schema with a custom failing test yields an error with no `path`.
    const rootSchema = yup
      .mixed()
      .test('always-fails', 'root rejected', () => false)
    const validator = yupValidator(rootSchema)

    const result = await validator.validate('anything')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.path).toBe('')
      expect(result.errors[0]?.message).toBe('root rejected')
    }
  })

  it('toJsonSchema() converts the schema (type, properties, required, constraints)', () => {
    const validator = yupValidator(userSchema)
    const schema = validator.toJsonSchema?.() as {
      type?: string
      properties?: Record<string, { type?: string; minimum?: number }>
      required?: string[]
    }

    expect(schema?.type).toBe('object')
    expect(schema?.properties?.name?.type).toBe('string')
    // `age` is a required `.min(0)` number → integer-less number with a minimum, in the required list.
    expect(schema?.properties?.age?.type).toBe('number')
    expect(schema?.properties?.age?.minimum).toBe(0)
    expect(schema?.required).toEqual(expect.arrayContaining(['name', 'age']))
  })
})
