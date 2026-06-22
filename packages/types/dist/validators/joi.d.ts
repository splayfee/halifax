import Joi from 'joi';
import type { ISchemaValidator } from '../interfaces/ISchemaValidator.js';
/**
 * Wrap a Joi schema in Halifax's validator-agnostic {@link ISchemaValidator} contract so it can
 * drive both request validation and OpenAPI generation.
 *
 * `toJsonSchema()` converts the schema's `describe()` output into JSON Schema (objects, arrays,
 * scalars, dates, `valid()` enums, and common rules such as `integer`/`min`/`max`/`length`/`email`/
 * `uuid`/`pattern`), so Joi-validated custom endpoints get an auto-generated OpenAPI request schema.
 *
 * @typeParam T - The validated/coerced value type produced by the schema.
 * @param schema - The Joi schema to adapt.
 * @returns An {@link ISchemaValidator} backed by `schema`.
 */
export declare function joiValidator<T = unknown>(schema: Joi.Schema<T>): ISchemaValidator<T>;
