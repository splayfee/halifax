import type { HttpRequest } from '@/core/types.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'
import type { FieldError, ISchemaValidator } from '@edium/halifax-types'

/**
 * Optional, validator-agnostic schemas for a custom endpoint. Any adapter implementing
 * {@link ISchemaValidator} works (Yup, Zod, Joi, Valibot, …) — see `@edium/halifax-types`.
 * When present, the matching request part is validated (and coerced) before the handler runs;
 * a failure short-circuits with `422` and a `details.fieldErrors` list. A schema that can emit a
 * JSON Schema (via `toJsonSchema()`) also auto-populates the endpoint's OpenAPI documentation.
 */
export interface CustomEndpointSchemas {
  /** Validates and coerces `req.body`. */
  body?: ISchemaValidator
  /** Validates and coerces `req.query`. */
  query?: ISchemaValidator
  /** Validates and coerces `req.params`. */
  params?: ISchemaValidator
}

/** Prefixes a field error's path with the request part it came from (`body`/`query`/`params`). */
function prefixPath(part: string, path: string): string {
  return path ? `${part}.${path}` : part
}

/**
 * Runs the endpoint's `body`/`query`/`params` schemas against the request, collecting every
 * failure across all three parts. On success the coerced values are written back onto the request
 * (so the handler sees normalized input). On any failure throws a single {@link UnprocessableEntityError}
 * whose `details.fieldErrors` lists every offending field.
 */
export async function runValidation(
  schemas: CustomEndpointSchemas,
  req: HttpRequest
): Promise<void> {
  const parts: Array<['body' | 'query' | 'params', ISchemaValidator | undefined]> = [
    ['body', schemas.body],
    ['query', schemas.query],
    ['params', schemas.params]
  ]
  const fieldErrors: FieldError[] = []
  const mutable = req as Record<'body' | 'query' | 'params', unknown>
  for (const [part, validator] of parts) {
    if (!validator) continue
    const result = await validator.validate(mutable[part])
    if (result.success) {
      mutable[part] = result.value
    } else {
      for (const e of result.errors)
        fieldErrors.push({ path: prefixPath(part, e.path), message: e.message })
    }
  }
  if (fieldErrors.length)
    throw new UnprocessableEntityError('Request validation failed.', { fieldErrors })
}
