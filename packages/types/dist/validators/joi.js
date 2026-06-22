import Joi from 'joi';
/** Applies `valid()` enums and rule-derived constraints (min/max/length/email/pattern/…) to a node. */
function applyRules(out, desc) {
    if (desc.flags?.only && Array.isArray(desc.allow) && desc.allow.length > 0)
        out.enum = [...desc.allow];
    for (const rule of desc.rules ?? []) {
        const args = rule.args ?? {};
        switch (rule.name) {
            case 'integer':
                if (out.type === 'number')
                    out.type = 'integer';
                break;
            case 'min':
                if (typeof args.limit === 'number')
                    out[out.type === 'string' ? 'minLength' : 'minimum'] = args.limit;
                break;
            case 'max':
                if (typeof args.limit === 'number')
                    out[out.type === 'string' ? 'maxLength' : 'maximum'] = args.limit;
                break;
            case 'length':
                if (typeof args.limit === 'number') {
                    out.minLength = args.limit;
                    out.maxLength = args.limit;
                }
                break;
            case 'email':
                out.format = 'email';
                break;
            case 'uri':
                out.format = 'uri';
                break;
            case 'guid':
            case 'uuid':
                out.format = 'uuid';
                break;
            case 'pattern':
                if (args.regex instanceof RegExp)
                    out.pattern = args.regex.source;
                break;
            default:
                break;
        }
    }
    return out;
}
/** Recursively converts a Joi schema description into a JSON Schema node. */
function descriptionToJsonSchema(desc) {
    switch (desc.type) {
        case 'object': {
            const properties = {};
            const required = [];
            for (const [key, child] of Object.entries(desc.keys ?? {})) {
                properties[key] = descriptionToJsonSchema(child);
                if (child.flags?.presence === 'required')
                    required.push(key);
            }
            const out = { type: 'object', properties };
            if (required.length > 0)
                out.required = required;
            return applyRules(out, desc);
        }
        case 'array':
            return applyRules({ type: 'array', items: desc.items?.[0] ? descriptionToJsonSchema(desc.items[0]) : {} }, desc);
        case 'string':
            return applyRules({ type: 'string' }, desc);
        case 'number':
            return applyRules({ type: 'number' }, desc);
        case 'boolean':
            return applyRules({ type: 'boolean' }, desc);
        case 'date':
            return applyRules({ type: 'string', format: 'date-time' }, desc);
        default:
            return applyRules({}, desc);
    }
}
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
export function joiValidator(schema) {
    return {
        validate(data) {
            const { error, value } = schema.validate(data, {
                abortEarly: false,
                stripUnknown: true,
                convert: true
            });
            if (error === undefined) {
                return { success: true, value: value };
            }
            const errors = error.details.map((detail) => ({
                path: detail.path.join('.'),
                message: detail.message
            }));
            return { success: false, errors };
        },
        toJsonSchema() {
            try {
                return descriptionToJsonSchema(schema.describe());
            }
            catch {
                return undefined;
            }
        }
    };
}
