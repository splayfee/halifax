import { describe, it, expect } from 'vitest'
import Joi from 'joi'
import { joiValidator } from '../../src/validators/joi.js'

describe('joiValidator', () => {
  it('returns success with the coerced value for valid input', () => {
    const validator = joiValidator(
      Joi.object({
        name: Joi.string().required(),
        age: Joi.number().required()
      })
    )

    // `age` arrives as a string; convert: true coerces it to a number.
    const result = validator.validate({ name: 'Ada', age: '42' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.value).toEqual({ name: 'Ada', age: 42 })
    }
  })

  it('returns failure with the correct path and message for invalid input', () => {
    const validator = joiValidator(
      Joi.object({
        email: Joi.string().email().required()
      })
    )

    const result = validator.validate({ email: 'not-an-email' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.path).toBe('email')
      expect(result.errors[0]?.message).toContain('email')
    }
  })

  it('collects every error when abortEarly is false', () => {
    const validator = joiValidator(
      Joi.object({
        name: Joi.string().required(),
        age: Joi.number().required(),
        email: Joi.string().email().required()
      })
    )

    const result = validator.validate({})

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors).toHaveLength(3)
      const paths = result.errors.map((e) => e.path).sort()
      expect(paths).toEqual(['age', 'email', 'name'])
    }
  })

  it('toJsonSchema() converts the schema (type, properties, required, rules)', () => {
    const validator = joiValidator(
      Joi.object({
        name: Joi.string().required(),
        age: Joi.number().integer().min(0),
        role: Joi.string().valid('admin', 'user')
      })
    )
    const schema = validator.toJsonSchema?.() as {
      type?: string
      properties?: Record<string, { type?: string; minimum?: number; enum?: unknown[] }>
      required?: string[]
    }

    expect(schema?.type).toBe('object')
    expect(schema?.properties?.name?.type).toBe('string')
    expect(schema?.properties?.age?.type).toBe('integer')
    expect(schema?.properties?.age?.minimum).toBe(0)
    expect(schema?.properties?.role?.enum).toEqual(['admin', 'user'])
    expect(schema?.required).toEqual(['name'])
  })
})
