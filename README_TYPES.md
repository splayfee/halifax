# Types — `@edium/halifax`

All publicly exported TypeScript type aliases, enums, and constants. Interfaces are in [README_INTERFACES.md](./README_INTERFACES.md); classes are in [README_CLASSES.md](./README_CLASSES.md).

---

## Type Aliases

### Core / Resource

| Type               | Import path      | Definition                                                                                                                                       | Description                                                                                                                                |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `CrudAction`       | `@edium/halifax` | `'create' \| 'readOne' \| 'readMany' \| 'readManyWithQueryBuilder' \| 'updateOne' \| 'updateMany' \| 'upsertOne' \| 'deleteOne' \| 'deleteMany'` | Identifies a single CRUD operation. Used in `requiredPermissions` maps and `AuthorizeParams`.                                              |
| `FieldType`        | `@edium/halifax` | `'string' \| 'integer' \| 'number' \| 'boolean' \| 'object'`                                                                                     | OpenAPI-compatible scalar type for a field. Set on `FieldDefinition.type` for custom repos; auto-populated by Prisma and Drizzle adapters. |
| `HttpMethod`       | `@edium/halifax` | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE' \| '*'`                                                                                         | HTTP methods supported by Halifax routes. `'*'` is used for 405 catch-all handlers.                                                        |
| `HttpRouteHandler` | `@edium/halifax` | `(req: HttpRequest, res: HttpResponse) => Promise<void> \| void`                                                                                 | Function signature for framework-agnostic route handlers passed to `HttpServer.registerRoute`.                                             |

### Auth

| Type             | Import path      | Definition                                                                                                               | Description                                                                                                                            |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SecurityScheme` | `@edium/halifax` | `{ type: 'apiKey'; in: 'header' \| 'query' \| 'cookie'; name: string } \| { type: 'http'; scheme: 'bearer' \| 'basic' }` | OpenAPI 3.1 security scheme descriptor returned by `AuthStrategy.openApiScheme()`. Used to populate the Swagger UI "Authorize" button. |

### Response envelopes

| Type                        | Import path      | Definition                                    | Description                                                                                     |
| --------------------------- | ---------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ListResult<TRecord>`       | `@edium/halifax` | `{ count: number; results: TRecord[] }`       | Returned by `getMany` and `executeQuery`. `count` is the total matching rows before pagination. |
| `QueryResult<TRecord>`      | `@edium/halifax` | `{ count?: number; results: TRecord[] }`      | Returned by `executeQuery` (query-builder endpoint). `count` is optional.                       |
| `UpdateManyResult<TRecord>` | `@edium/halifax` | `{ updated: unknown[]; results?: TRecord[] }` | Returned by `updateMany`. `updated` is the list of affected IDs.                                |
| `DeleteManyResult`          | `@edium/halifax` | `{ deleted: unknown[] }`                      | Returned by `deleteMany`. `deleted` is the list of affected IDs.                                |

### Query AST

| Type          | Import path      | Definition                            | Description                                                             |
| ------------- | ---------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| `QueryScalar` | `@edium/halifax` | `string \| number \| boolean \| null` | Scalar value accepted by filter comparison operators in `IQueryFilter`. |

### Validation (see [README_VALIDATION.md](./README_VALIDATION.md))

| Type                  | Import path      | Definition                                                                | Description                                                 |
| --------------------- | ---------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ValidationResult<T>` | `@edium/halifax` | `{ success: true; value: T } \| { success: false; errors: FieldError[] }` | Outcome of `ISchemaValidator.validate`.                     |
| `FieldError`          | `@edium/halifax` | `{ path: string; message: string }`                                       | A single validation failure (dotted `path`, `''` = root).   |
| `JsonSchema`          | `@edium/halifax` | `Record<string, unknown>`                                                 | Opaque JSON Schema object merged into the OpenAPI document. |

### Stored procedures (see [README_EXECUTE.md](./README_EXECUTE.md))

| Type               | Import path      | Definition                                                                     | Description                                         |
| ------------------ | ---------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `ExecuteScalar`    | `@edium/halifax` | `string \| number \| boolean`                                                  | A JSON-safe stored-procedure argument scalar.       |
| `ExecuteValue`     | `@edium/halifax` | `ExecuteScalar \| ExecuteScalar[]`                                             | A single argument value (scalar or array).          |
| `ExecuteParams`    | `@edium/halifax` | `Record<string, ExecuteValue>`                                                 | Named arguments in a stored-procedure request body. |
| `ExecuteParamType` | `@edium/halifax` | `'string' \| 'number' \| 'boolean' \| 'string[]' \| 'number[]' \| 'boolean[]'` | Declared JSON type of a parameter.                  |

### HTTP adapter type aliases

These are aliased to `CrudApiOptions` — documented in [README_INTERFACES.md](./README_INTERFACES.md).

| Type                               | Import path      | Description                                                                                                      |
| ---------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ExpressCrudRouterOptions`         | `@edium/halifax` | Alias of `CrudApiOptions`. The options type accepted by `createExpressCrudRouter`.                               |
| `FastifyCrudPluginOptions`         | `@edium/halifax` | Alias of `CrudApiOptions`. The options type accepted by `createFastifyCrudPlugin`.                               |
| `FastifyCrudPlugin`                | `@edium/halifax` | `(instance: FastifyAppLike) => Promise<void>`. Type of the Fastify plugin returned by `createFastifyCrudPlugin`. |
| `HyperExpressCrudRouterOptions`    | `@edium/halifax` | Alias of `CrudApiOptions`. The options type accepted by `createHyperExpressCrudRouter`.                          |
| `UltimateExpressCrudRouterOptions` | `@edium/halifax` | Alias of `CrudApiOptions`. The options type accepted by `createUltimateExpressCrudRouter`.                       |

### Drizzle sub-path (`@edium/halifax/drizzle`)

| Type           | Import path              | Definition                  | Description                                                                                                                               |
| -------------- | ------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `AnyDrizzleDB` | `@edium/halifax/drizzle` | `any`                       | A Drizzle database connection of any driver type. Typed as `any` because Drizzle does not export a single unified DB type across drivers. |
| `ColumnMap`    | `@edium/halifax/drizzle` | `Record<string, AnyColumn>` | Map from column name to Drizzle `AnyColumn`, used internally by the AST compiler. Useful when writing custom Drizzle query extensions.    |

---

## Enums

All three enums are re-exported from `@edium/halifax-types` through the main `@edium/halifax` entry point.

### `SqlComparison`

Comparison operators used in `IQueryFilter.comparison`. Accepted by the query-builder endpoint (`POST /:resource/query`) and `QueryBuilder` methods.

| Value                | Operator      | Notes                     |
| -------------------- | ------------- | ------------------------- |
| `Equal`              | `=`           |                           |
| `NotEqual`           | `<>`          |                           |
| `LessThan`           | `<`           |                           |
| `LessThanOrEqual`    | `<=`          |                           |
| `GreaterThan`        | `>`           |                           |
| `GreaterThanOrEqual` | `>=`          |                           |
| `In`                 | `IN`          | `value1` must be an array |
| `NotIn`              | `NOT IN`      | `value1` must be an array |
| `Between`            | `BETWEEN`     | Use `value1` and `value2` |
| `NotBetween`         | `NOT BETWEEN` | Use `value1` and `value2` |
| `Like`               | `LIKE`        | `%` wildcard              |
| `NotLike`            | `NOT LIKE`    |                           |
| `Contains`           | `CONTAINS`    | Substring match           |
| `StartsWith`         | `STARTS WITH` | Prefix match              |
| `EndsWith`           | `ENDS WITH`   | Suffix match              |
| `IsNull`             | `IS NULL`     | Omit `value1`             |
| `IsNotNull`          | `IS NOT NULL` | Omit `value1`             |

### `SqlOperator`

Logical operator that joins a filter condition to the next sibling condition in a `where` array.

| Value | Description                                  |
| ----- | -------------------------------------------- |
| `And` | `AND` — the next condition must also be true |
| `Or`  | `OR` — the next condition is an alternative  |

### `SqlOrder`

Sort direction for `ISort.order` and `QueryBuilder.orderBy`.

| Value  | Direction           |
| ------ | ------------------- |
| `ASC`  | Ascending (default) |
| `DESC` | Descending          |

---

## Constants

| Constant                 | Import path      | Value              | Description                                                                                                                                      |
| ------------------------ | ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DEFAULT_PAGE_LIMIT`     | `@edium/halifax` | `5000`             | Default page size applied when a resource sets no `defaultLimit` and the caller omits `?limit=`. Set `defaultLimit: 0` on a resource to disable. |
| `MAX_PAGE_LIMIT`         | `@edium/halifax` | `5000`             | Default hard cap on page size. Requests above this are silently capped. Set `maxLimit: 0` on a resource to remove the cap.                       |
| `defaultCrudPermissions` | `@edium/halifax` | All actions `true` | The `CrudPermissions` object applied to every resource — all nine CRUD actions enabled. Override per-resource with `permissions`.                |
