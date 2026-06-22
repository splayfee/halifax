import * as yup from 'yup';
/** Applies enum, nullability, and common test-derived constraints onto a base schema node. */
function applyConstraints(out, desc) {
    if (Array.isArray(desc.oneOf) && desc.oneOf.length > 0)
        out.enum = [...desc.oneOf];
    if (desc.label)
        out.description = desc.label;
    for (const test of desc.tests ?? []) {
        const p = test.params ?? {};
        switch (test.name) {
            case 'integer':
                if (out.type === 'number')
                    out.type = 'integer';
                break;
            case 'min':
                if (typeof p.min === 'number')
                    out[out.type === 'string' ? 'minLength' : 'minimum'] = p.min;
                break;
            case 'max':
                if (typeof p.max === 'number')
                    out[out.type === 'string' ? 'maxLength' : 'maximum'] = p.max;
                break;
            case 'length':
                if (typeof p.length === 'number') {
                    out.minLength = p.length;
                    out.maxLength = p.length;
                }
                break;
            case 'email':
                out.format = 'email';
                break;
            case 'url':
                out.format = 'uri';
                break;
            case 'uuid':
                out.format = 'uuid';
                break;
            case 'matches':
                if (p.regex instanceof RegExp)
                    out.pattern = p.regex.source;
                break;
            default:
                break;
        }
    }
    // OpenAPI 3.1 / JSON Schema: express nullability by widening `type` to include 'null'.
    if (desc.nullable && typeof out.type === 'string')
        out.type = [out.type, 'null'];
    return out;
}
/** Recursively converts a yup schema description into a JSON Schema node. */
function descriptionToJsonSchema(desc) {
    switch (desc.type) {
        case 'object': {
            const properties = {};
            const required = [];
            for (const [key, field] of Object.entries(desc.fields ?? {})) {
                properties[key] = descriptionToJsonSchema(field);
                // A field is required unless yup marks it optional (`.required()` sets optional = false).
                if (field.optional === false)
                    required.push(key);
            }
            const out = { type: 'object', properties };
            if (required.length > 0)
                out.required = required;
            return applyConstraints(out, desc);
        }
        case 'array':
            return applyConstraints({ type: 'array', items: desc.innerType ? descriptionToJsonSchema(desc.innerType) : {} }, desc);
        case 'string':
            return applyConstraints({ type: 'string' }, desc);
        case 'number':
            return applyConstraints({ type: 'number' }, desc);
        case 'boolean':
            return applyConstraints({ type: 'boolean' }, desc);
        case 'date':
            return applyConstraints({ type: 'string', format: 'date-time' }, desc);
        default:
            // `mixed` and unknown types map to "any" (an empty schema).
            return applyConstraints({}, desc);
    }
}
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
export function yupValidator(schema) {
    return {
        async validate(data) {
            try {
                const value = await schema.validate(data, {
                    abortEarly: false,
                    stripUnknown: true
                });
                return { success: true, value };
            }
            catch (err) {
                if (err instanceof yup.ValidationError) {
                    // With abortEarly: false, every failure is collected in `inner`. When the error has no
                    // nested errors (e.g. a single root-level failure), fall back to the top-level error.
                    const source = err.inner.length > 0 ? err.inner : [err];
                    const errors = source.map((e) => ({
                        path: e.path ?? '',
                        message: e.message
                    }));
                    return { success: false, errors };
                }
                // Not a validation failure — surface programmer/runtime errors to the caller.
                throw err;
            }
        },
        toJsonSchema() {
            try {
                return descriptionToJsonSchema(schema.describe());
            }
            catch {
                // A schema that can't be described (e.g. a lazy/conditional schema needing context)
                // simply yields no generated request schema rather than breaking OpenAPI generation.
                return undefined;
            }
        }
    };
}
