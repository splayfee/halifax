import * as v from 'valibot';
/** Wrapper schema types that make a field optional. */
const OPTIONAL_TYPES = new Set(['optional', 'nullish', 'undefinedable', 'exact_optional']);
/** Wrapper schema types that make a value nullable. */
const NULLABLE_TYPES = new Set(['nullable', 'nullish']);
/** True when an object entry is not required (wrapped in optional/nullish/…). */
function isOptional(node) {
    return node.type !== undefined && OPTIONAL_TYPES.has(node.type);
}
/** Applies pipe validations (integer/min/max/length/email/url/uuid/regex) onto a node. */
function applyPipe(out, pipe) {
    for (const item of pipe ?? []) {
        if (item.kind !== 'validation')
            continue;
        const req = item.requirement;
        switch (item.type) {
            case 'integer':
                if (out.type === 'number')
                    out.type = 'integer';
                break;
            case 'min_value':
                if (typeof req === 'number')
                    out.minimum = req;
                break;
            case 'max_value':
                if (typeof req === 'number')
                    out.maximum = req;
                break;
            case 'min_length':
                if (typeof req === 'number')
                    out.minLength = req;
                break;
            case 'max_length':
                if (typeof req === 'number')
                    out.maxLength = req;
                break;
            case 'length':
                if (typeof req === 'number') {
                    out.minLength = req;
                    out.maxLength = req;
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
            case 'regex':
                if (req instanceof RegExp)
                    out.pattern = req.source;
                break;
            default:
                break;
        }
    }
}
/** Recursively converts a Valibot schema node into a JSON Schema node. */
function nodeToJsonSchema(node) {
    // Unwrap optional/nullable/nullish wrappers, tracking nullability.
    let current = node;
    let nullable = false;
    while (current.wrapped &&
        (OPTIONAL_TYPES.has(current.type ?? '') || NULLABLE_TYPES.has(current.type ?? ''))) {
        if (NULLABLE_TYPES.has(current.type ?? ''))
            nullable = true;
        current = current.wrapped;
    }
    let out;
    switch (current.type) {
        case 'object': {
            const properties = {};
            const required = [];
            for (const [key, child] of Object.entries(current.entries ?? {})) {
                properties[key] = nodeToJsonSchema(child);
                if (!isOptional(child))
                    required.push(key);
            }
            out = { type: 'object', properties };
            if (required.length > 0)
                out.required = required;
            break;
        }
        case 'array':
            out = { type: 'array', items: current.item ? nodeToJsonSchema(current.item) : {} };
            break;
        case 'string':
            out = { type: 'string' };
            break;
        case 'number':
            out = { type: 'number' };
            break;
        case 'boolean':
            out = { type: 'boolean' };
            break;
        case 'date':
            out = { type: 'string', format: 'date-time' };
            break;
        case 'picklist':
        case 'enum':
            out = Array.isArray(current.options) ? { enum: [...current.options] } : {};
            break;
        case 'literal':
            out = current.literal !== undefined ? { const: current.literal } : {};
            break;
        default:
            out = {};
    }
    applyPipe(out, current.pipe);
    if (nullable && typeof out.type === 'string')
        out.type = [out.type, 'null'];
    return out;
}
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
export function valibotValidator(schema) {
    return {
        validate(data) {
            const result = v.safeParse(schema, data);
            if (result.success) {
                return { success: true, value: result.output };
            }
            const errors = result.issues.map((issue) => ({
                // getDotPath returns a dotted path string, or null for a root-level issue.
                path: v.getDotPath(issue) ?? '',
                message: issue.message
            }));
            return { success: false, errors };
        },
        toJsonSchema() {
            try {
                return nodeToJsonSchema(schema);
            }
            catch {
                return undefined;
            }
        }
    };
}
