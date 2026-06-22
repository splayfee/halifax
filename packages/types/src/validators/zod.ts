import { z } from 'zod'
import type {
  ISchemaValidator,
  ValidationResult,
  FieldError,
  JsonSchema
} from '../interfaces/ISchemaValidator.js'

/**
 * Wrap a Zod schema in Halifax's validator-agnostic {@link ISchemaValidator} contract.
 *
 * `validate` delegates to `schema.safeParse`, returning the coerced value on success or a flat
 * list of {@link FieldError}s (dotted paths) on failure. `toJsonSchema` uses Zod v4's native
 * `z.toJSONSchema` when present, and returns `undefined` on older Zod builds that lack it.
 *
 * @param schema - The Zod schema to adapt.
 * @returns An {@link ISchemaValidator} backed by `schema`.
 */
export function zodValidator<T>(schema: z.ZodType<T>): ISchemaValidator<T> {
  return {
    validate(data: unknown): ValidationResult<T> {
      const result = schema.safeParse(data)
      if (result.success) {
        return { success: true, value: result.data }
      }
      const errors: FieldError[] = result.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.'),
        message: issue.message
      }))
      return { success: false, errors }
    },
    toJsonSchema(): JsonSchema | undefined {
      if (typeof z.toJSONSchema !== 'function') {
        return undefined
      }
      return z.toJSONSchema(schema) as JsonSchema
    }
  }
}
