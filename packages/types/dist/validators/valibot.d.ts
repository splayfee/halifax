import * as v from 'valibot';
import type { ISchemaValidator } from '../interfaces/ISchemaValidator.js';
/**
 * Wrap a Valibot schema in Halifax's validator-agnostic {@link ISchemaValidator} interface.
 *
 * Validation uses `v.safeParse`, which collects every issue rather than throwing, so an invalid
 * input is mapped into a `{ success: false, errors }` result. Each issue's dotted path is derived
 * with `v.getDotPath` (e.g. `'address.zip'`, `'items.0.qty'`); a root-level issue yields `''`.
 *
 * `toJsonSchema()` walks the schema structure (objects, arrays, scalars, dates, picklists, literals,
 * optional/nullable wrappers, and pipe validations such as `integer`/`minValue`/`email`/`regex`) to
 * produce a JSON Schema, so Valibot-validated custom endpoints get an auto-generated OpenAPI request
 * schema with no extra dependency.
 *
 * @typeParam T - The validated/coerced output type produced by the schema.
 * @param schema - The Valibot schema to adapt.
 * @returns An {@link ISchemaValidator} backed by `schema`.
 */
export declare function valibotValidator<T>(schema: v.GenericSchema<unknown, T>): ISchemaValidator<T>;
