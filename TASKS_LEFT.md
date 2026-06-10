# What's Left

- Add typed examples for `PrismaClient` delegates (documentation / example project).
- Formalize query AST: normalize `IQueryOptions` into an internal AST type before compiling to SQL, so the compilation pipeline is independently testable.
- Add query depth / cost controls for deeply nested `children` filters before exposing advanced query endpoints publicly.

## REST API Standards Compliance Gaps

**§ 10 — Error response format (breaking change)**
Standard requires:
```json
{ "errors": [{ "code": "VALIDATION_ERROR", "field": "email", "message": "..." }] }
```
Halifax currently returns:
```json
{ "error": { "name": "PayloadError", "message": "..." } }
```
Changes needed: rename top-level key to `errors`, make it an array, rename `name` → `code` (and standardize code values like `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `INTERNAL_ERROR`), add optional `field` property to `HttpError` and surface it in the error array items.