import { z } from 'zod';
import type { ISchemaValidator } from '../interfaces/ISchemaValidator.js';
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
export declare function zodValidator<T>(schema: z.ZodType<T>): ISchemaValidator<T>;
