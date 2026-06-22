# Halifax — Request Validation (validator-agnostic)

Custom endpoints can validate (and coerce) the request `body`, `query`, and `params` from a schema —
and the **same** schema auto-documents the endpoint in OpenAPI. Halifax never couples to one
validation library: you pass an `ISchemaValidator`, and official adapters wrap Yup, Zod, Joi, and
Valibot.

## The contract

```ts
import type {
  ISchemaValidator,
  ValidationResult,
  FieldError,
  JsonSchema
} from '@edium/halifax-types'

interface ISchemaValidator<T = unknown> {
  validate(data: unknown): ValidationResult<T> | Promise<ValidationResult<T>>
  toJsonSchema?(): JsonSchema | undefined
}
```

`ValidationResult<T>` is `{ success: true; value: T } | { success: false; errors: FieldError[] }`.
The interface lives in `@edium/halifax-types`, so the server and `@edium/halifax-client` share it.

## Using it on a custom endpoint

```ts
import { yupValidator } from '@edium/halifax/yup' // or /zod, /joi, /valibot
import * as yup from 'yup'

api.addCustomEndpoint(
  'POST',
  '/orders',
  {
    roles: ['orders:write'],
    validate: {
      body: yupValidator(
        yup.object({
          sku: yup.string().required(),
          qty: yup.number().integer().positive().required()
        })
      )
    }
  },
  async (req, res) => {
    // req.body is validated AND coerced (e.g. "3" → 3, unknown keys stripped).
    const { sku, qty } = req.body as { sku: string; qty: number }
    await res.status(201).json(await createOrder(sku, qty))
  }
)
```

- On success the coerced value replaces `req.body` / `req.query` / `req.params` before the handler runs.
- On failure the request short-circuits with **`422`** and a body of
  `{ errors: [{ code: 'UNPROCESSABLE_ENTITY', message: 'Request validation failed.', details: { fieldErrors: [...] } }] }`.
  Each `fieldError.path` is prefixed with the request part — e.g. `body.qty`, `query.limit`.
- Errors from all three parts (`body`, `query`, `params`) are collected together, not one at a time.

## Auto-generated OpenAPI

When the API is configured with `openapi: { enabled: true }` and a schema can emit a JSON Schema via
`toJsonSchema()`, Halifax fills the operation's `requestBody` (from `body`) and `parameters` (from
`query`/`params`) automatically — no hand-written `openapi` metadata needed. Explicitly-provided
`openapi` metadata always takes precedence.

| Adapter                         | Validates | `toJsonSchema()` (auto-OpenAPI)   |
| ------------------------------- | --------- | --------------------------------- |
| `zodValidator` (`/zod`)         | ✅        | ✅ native `z.toJSONSchema`        |
| `yupValidator` (`/yup`)         | ✅        | ✅ via `schema.describe()`        |
| `joiValidator` (`/joi`)         | ✅        | ✅ via `schema.describe()`        |
| `valibotValidator` (`/valibot`) | ✅        | ✅ via schema-structure traversal |

**All four adapters generate an OpenAPI request schema out of the box** — objects, arrays, scalars,
dates, enums, nullability, and common constraints (`integer`/`min`/`max`/`length`/`email`/`url`/`uuid`/
`pattern`). No extra converter package is required, so the schemas you already have document
themselves with zero rewrites. (Each maps the subset of features it can introspect; an unsupported
construct degrades to a permissive node rather than failing.)

## Writing your own adapter

Any object satisfying `ISchemaValidator` works:

```ts
const evenNumber: ISchemaValidator<number> = {
  validate(data) {
    const n = Number(data)
    return Number.isInteger(n) && n % 2 === 0
      ? { success: true, value: n }
      : { success: false, errors: [{ path: '', message: 'Must be an even integer.' }] }
  },
  toJsonSchema: () => ({ type: 'integer', multipleOf: 2 })
}
```
