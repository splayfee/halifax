import * as yup from 'yup';
import type { ISchemaValidator } from '../interfaces/ISchemaValidator.js';
/**
 * Wrap a Yup schema in Halifax's validator-agnostic {@link ISchemaValidator} interface.
 *
 * The returned adapter validates with `{ abortEarly: false, stripUnknown: true }` so every
 * failing field is collected (not just the first) and unknown keys are dropped from the coerced
 * value. Validation never throws for ordinary failures — a `yup.ValidationError` is mapped into a
 * `{ success: false, errors }` result instead.
 *
 * `toJsonSchema()` converts the schema's `describe()` output into JSON Schema (objects, arrays,
 * scalars, dates, enums, nullability, and common constraints such as `integer`/`min`/`max`/`email`/
 * `matches`), so yup-validated custom endpoints get an auto-generated OpenAPI request schema.
 *
 * @typeParam T - The validated/coerced output type produced by the schema.
 * @param schema - The Yup schema to adapt.
 * @returns An {@link ISchemaValidator} backed by `schema`.
 */
export declare function yupValidator<T>(schema: yup.Schema<T>): ISchemaValidator<T>;
