/**
 * A single validation failure. Returned (in a list) by {@link ISchemaValidator.validate}
 * when input does not satisfy the schema, and serialized into the 422 response body.
 */
export interface FieldError {
  /**
   * Dotted path to the offending field (e.g. `'address.zip'`, `'items.0.qty'`).
   * The empty string `''` denotes a root-level error.
   */
  path: string
  /** Human-readable description of why the value was rejected. */
  message: string
}

/**
 * A minimal JSON Schema object (the OpenAPI 3.1-compatible subset). Halifax treats this as an
 * opaque bag it merges into the live OpenAPI document — it does not interpret the contents.
 */
export type JsonSchema = Record<string, unknown>

/**
 * Outcome of a single {@link ISchemaValidator.validate} call. On success the (possibly coerced)
 * value is returned; on failure a non-empty list of {@link FieldError}s explains what was wrong.
 */
export type ValidationResult<T = unknown> =
  | { success: true; value: T }
  | { success: false; errors: FieldError[] }

/**
 * Validator-agnostic schema adapter. Halifax never depends on a concrete validation library;
 * instead, a thin adapter wraps a Yup / Zod / Joi / Valibot (or any other) schema in this
 * interface so the same schema can drive **both** request validation and OpenAPI generation.
 *
 * Official adapters are shipped as opt-in subpaths of `@edium/halifax-types`
 * (`@edium/halifax-types/yup`, `/zod`, `/joi`, `/valibot`) and re-exported for convenience from
 * `@edium/halifax` (`@edium/halifax/yup`, …). Both the server and `@edium/halifax-client` consume
 * this same contract, so a schema authored once validates identically on either side.
 */
export interface ISchemaValidator<T = unknown> {
  /**
   * Validate (and optionally coerce) `data`.
   * @param data - The raw input to validate (request body, query, or params).
   * @returns A {@link ValidationResult} — `{ success: true, value }` with the coerced value, or
   *   `{ success: false, errors }` listing every field that failed. Implementations should never
   *   throw for ordinary validation failures; reserve throwing for programmer errors.
   */
  validate(data: unknown): ValidationResult<T> | Promise<ValidationResult<T>>
  /**
   * Best-effort JSON Schema for OpenAPI documentation. Optional: return `undefined` (or omit the
   * method) when the underlying library cannot produce one, in which case Halifax simply documents
   * the endpoint without a generated request schema.
   */
  toJsonSchema?(): JsonSchema | undefined
}
