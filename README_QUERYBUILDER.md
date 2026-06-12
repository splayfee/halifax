# Query Builder

The query builder exposes an advanced `POST /:resource/query` endpoint that accepts a structured JSON payload (an AST — abstract syntax tree) describing filters, sorting, pagination, and projection. It lets the front-end compose rich list queries "for free", without the back-end adding custom endpoints. (The path segment defaults to `query`; override it with the `queryBuilderPath` option.)

**Database-agnostic by design.** The payload is fully validated against the resource — every field name, comparison, sort, and nesting depth — and invalid input returns a structured `400`/`422` _before_ any database call. The validated AST is then compiled to portable **Prisma Client** calls (never raw SQL), so the exact same request behaves identically on PostgreSQL, MySQL/MariaDB, SQL Server, CockroachDB, and SQLite. Switch databases by changing only the Prisma `provider` — your client code never changes.

It is enabled by default; disable it per-resource with the `allowReadManyWithQueryBuilder` permission:

```ts
permissions: {
  allowReadManyWithQueryBuilder: false,
}
```

## Full Payload Reference

```ts
interface QueryPayload {
  fields?: string[] // columns to return (default: all)
  where?: QueryFilter[] // filter conditions
  orderBy?: SortEntry[] // sort order
  limit?: number // page size
  offset?: number // rows to skip
  distinct?: string[] // return rows distinct on these columns
}
```

> The query targets the resource's own model — there is no table name in the payload, so a caller can never point the query at another table.

### `fields`

An optional array of column names to include in the response. Omit it to return all columns (`SELECT *`).

Fields are validated against the resource's field definitions. A field with `selectable: false` returns 400.

```json
{ "fields": ["id", "title", "published"] }
```

### `where`

An array of filter conditions. Each entry is a `QueryFilter`:

```ts
interface QueryFilter {
  field: string // column name
  comparison: string // see comparisons table
  value1?: scalar | scalar[] // primary value (omit for IS NULL / IS NOT NULL)
  value2?: scalar // second value for BETWEEN / NOT BETWEEN
  operator?: 'AND' | 'OR' // required for all entries except the last
  children?: QueryFilter[] // nested group (produces parenthesised sub-clause)
}

type scalar = string | number | boolean | null
```

Fields are validated against the resource's field definitions. A field with `filterable: false` returns 400.

#### Comparisons

| `comparison`  | Prisma mapping                          | `value1`                   | `value2` |
| ------------- | --------------------------------------- | -------------------------- | -------- |
| `=`           | `{ equals }`                            | scalar                     | —        |
| `<>`          | `{ not }`                               | scalar                     | —        |
| `>`           | `{ gt }`                                | scalar                     | —        |
| `>=`          | `{ gte }`                               | scalar                     | —        |
| `<`           | `{ lt }`                                | scalar                     | —        |
| `<=`          | `{ lte }`                               | scalar                     | —        |
| `LIKE`        | `{ contains / startsWith / endsWith }`† | string (use `%` wildcards) | —        |
| `NOT LIKE`    | `{ NOT: … }`                            | string                     | —        |
| `CONTAINS`    | `{ contains }`                          | string                     | —        |
| `STARTS WITH` | `{ startsWith }`                        | string                     | —        |
| `ENDS WITH`   | `{ endsWith }`                          | string                     | —        |
| `IN`          | `{ in }`                                | array of scalars           | —        |
| `NOT IN`      | `{ notIn }`                             | array of scalars           | —        |
| `BETWEEN`     | `{ gte, lte }`                          | scalar                     | scalar   |
| `NOT BETWEEN` | `{ OR: [{ lt }, { gt }] }`              | scalar                     | scalar   |
| `IS NULL`     | `field: null`                           | —                          | —        |
| `IS NOT NULL` | `{ not: null }`                         | —                          | —        |

† `LIKE` parses `%` wildcards: `%x%` → `contains`, `x%` → `startsWith`, `%x` → `endsWith`, and a wildcard-free value collapses to `equals`. The portable `CONTAINS` / `STARTS WITH` / `ENDS WITH` operators (supported by both Prisma and Drizzle) are the recommended, dialect-independent way to do substring matching — unlike SQL `LIKE`, whose case-sensitivity varies by engine collation.

#### Examples

Simple equality:

```json
{ "field": "published", "comparison": "=", "value1": true }
```

Multi-condition with AND:

```json
[
  { "field": "published", "comparison": "=", "value1": true, "operator": "AND" },
  { "field": "title", "comparison": "LIKE", "value1": "%typescript%" }
]
```

IN list:

```json
{ "field": "authorId", "comparison": "IN", "value1": [1, 2, 3] }
```

NULL check:

```json
{ "field": "deletedAt", "comparison": "IS NULL" }
```

Range:

```json
{ "field": "score", "comparison": "BETWEEN", "value1": 10, "value2": 100 }
```

#### Nested filters (parenthesised groups)

Use `children` to wrap a group of conditions in parentheses:

```json
{
  "where": [
    { "field": "published", "comparison": "=", "value1": true, "operator": "AND" },
    {
      "operator": "OR",
      "children": [
        { "field": "authorId", "comparison": "=", "value1": 1, "operator": "OR" },
        { "field": "authorId", "comparison": "=", "value1": 2 }
      ]
    }
  ]
}
```

Produces: `WHERE published = $1 AND (authorId = $2 OR authorId = $3)`

### `orderBy`

An array of sort directives. Each entry:

```ts
interface SortEntry {
  field: string // column name — must be a defined, sortable resource field
  order: 'ASC' | 'DESC'
}
```

Fields with `sortable: false` return 400. When `orderBy` is omitted the query defaults to `ORDER BY id ASC`.

```json
{
  "orderBy": [
    { "field": "createdAt", "order": "DESC" },
    { "field": "id", "order": "ASC" }
  ]
}
```

### `limit`

Maximum number of rows to return. If the resource has a `maxLimit` configured, requests above that value are silently capped.

```json
{ "limit": 25 }
```

### `offset`

Number of rows to skip before returning results. Use with `limit` for pagination.

```json
{ "limit": 25, "offset": 50 }
```

Pagination maps to Prisma `take`/`skip`, so it works identically on every supported database.

### `distinct`

Return only rows distinct on the given columns (maps to Prisma `distinct`; supported by both Prisma and Drizzle). Columns are validated against the resource like any other field.

```json
{ "distinct": ["authorId"], "fields": ["authorId"] }
```

## Full Example

```json
POST /api/v1/posts/query
{
  "fields":  ["id", "title", "authorId", "createdAt"],
  "where": [
    { "field": "published", "comparison": "=",        "value1": true,  "operator": "AND" },
    { "field": "title",     "comparison": "CONTAINS",  "value1": "api" }
  ],
  "orderBy": [{ "field": "createdAt", "order": "DESC" }],
  "limit":   25,
  "offset":  0
}
```

## Response

```json
{
  "count": 142,
  "results": [
    {
      "id": 7,
      "title": "Building APIs with Halifax",
      "authorId": 2,
      "createdAt": "2025-01-15T10:00:00.000Z"
    }
  ]
}
```

`count` is the total number of matching rows (before pagination), not the length of `results`.
