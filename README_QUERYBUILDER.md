# Query Builder

The query builder exposes an advanced `POST /:resource/query-builder` endpoint that accepts a structured JSON payload and executes parameterized SQL through the adapter's native query path. It is designed for power-user list queries that go beyond simple field filters.

It is enabled by default, disable it per-resource with the `allowReadManyWithQueryBuilder` permission:

```ts
permissions: {
  allowReadManyWithQueryBuilder: false,
}
```

The adapter must have a `client` and `tableName` configured; without them the endpoint returns 501.

## Full Payload Reference

```ts
interface QueryPayload {
  fields?: string[] // columns to return (default: all)
  where?: QueryFilter[] // filter conditions
  orderBy?: SortEntry[] // sort order
  limit?: number // page size
  offset?: number // rows to skip
  isDistinct?: boolean // emit SELECT DISTINCT
}
```

> `tableName` is always ignored in the request body for security — the server uses the `tableName` from the resource definition.

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

| `comparison`  | SQL emitted                   | `value1`                   | `value2` |
| ------------- | ----------------------------- | -------------------------- | -------- |
| `=`           | `field = $n`                  | scalar                     | —        |
| `<>`          | `field <> $n`                 | scalar                     | —        |
| `>`           | `field > $n`                  | scalar                     | —        |
| `>=`          | `field >= $n`                 | scalar                     | —        |
| `<`           | `field < $n`                  | scalar                     | —        |
| `<=`          | `field <= $n`                 | scalar                     | —        |
| `LIKE`        | `field LIKE $n`               | string (use `%` wildcards) | —        |
| `NOT LIKE`    | `field NOT LIKE $n`           | string                     | —        |
| `IN`          | `field IN ($n, $m, …)`        | array of scalars           | —        |
| `NOT IN`      | `field NOT IN ($n, $m, …)`    | array of scalars           | —        |
| `BETWEEN`     | `field BETWEEN $n AND $m`     | string | number            | string | number |
| `NOT BETWEEN` | `field NOT BETWEEN $n AND $m` | string | number            | string | number |
| `IS NULL`     | `field IS NULL`               | —                          | —        |
| `IS NOT NULL` | `field IS NOT NULL`           | —                          | —        |

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

The adapter emits ANSI SQL pagination: `OFFSET n ROWS FETCH NEXT n ROWS ONLY`, supported by PostgreSQL 8.4+.

### `isDistinct`

When `true`, emits `SELECT DISTINCT` to deduplicate rows.

```json
{ "isDistinct": true, "fields": ["authorId"] }
```

## Full Example

```json
POST /api/v1/posts/query-builder
{
  "fields":     ["id", "title", "authorId", "createdAt"],
  "isDistinct": false,
  "where": [
    { "field": "published", "comparison": "=",    "value1": true,    "operator": "AND" },
    { "field": "title",     "comparison": "LIKE",  "value1": "%api%" }
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

## Using `QueryBuilder` Directly

The `QueryBuilder` class is exported for use outside the HTTP layer:

```ts
import { QueryBuilder, SqlComparison, SqlOrder } from '@edium/halifax'

const { statement, parameters } = QueryBuilder.buildSelectQuery({
  tableName: 'posts',
  fields: ['id', 'title'],
  where: [{ field: 'published', comparison: SqlComparison.Equal, value1: true }],
  orderBy: [{ field: 'createdAt', order: SqlOrder.DESC }],
  limit: 10,
  offset: 0
})
// statement:  SELECT id,title FROM posts WHERE published = $1 ORDER BY createdAt DESC OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY
// parameters: [true]
```

| Method                                         | Description                                        |
| ---------------------------------------------- | -------------------------------------------------- |
| `QueryBuilder.buildSelectQuery(options)`       | Full `SELECT` with WHERE, ORDER BY, and pagination |
| `QueryBuilder.buildCountQuery(options)`        | `SELECT COUNT(*) AS count` with optional WHERE     |
| `QueryBuilder.buildUpdateQuery(options, data)` | `UPDATE … SET …` with WHERE                        |
| `QueryBuilder.buildDeleteQuery(options)`       | `DELETE FROM …` with optional WHERE                |

All methods return `{ statement: string, parameters: unknown[] }` with PostgreSQL-style `$1`, `$2`, … placeholders.
