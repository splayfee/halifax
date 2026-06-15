# @edium/halifax-types

Shared TypeScript types and enums used by [`@edium/halifax`](https://www.npmjs.com/package/@edium/halifax) (the server) and [`@edium/halifax-client`](https://www.npmjs.com/package/@edium/halifax-client) (the browser/Node client).

You typically do **not** install this package directly — it is a dependency of `@edium/halifax` and `@edium/halifax-client` and is re-exported from both. Install it directly only if you need to type a query AST or a response shape without pulling in either of those packages.

## Install

```bash
pnpm add @edium/halifax-types
```

## Enums

### `SqlComparison`

Comparison operators for query filter conditions.

```ts
import { SqlComparison } from '@edium/halifax-types'

SqlComparison.Equal            // '='
SqlComparison.NotEqual         // '<>'
SqlComparison.GreaterThan      // '>'
SqlComparison.GreaterThanOrEqual // '>='
SqlComparison.LessThan         // '<'
SqlComparison.LessThanOrEqual  // '<='
SqlComparison.Between          // 'BETWEEN'
SqlComparison.NotBetween       // 'NOT BETWEEN'
SqlComparison.In               // 'IN'
SqlComparison.NotIn            // 'NOT IN'
SqlComparison.Like             // 'LIKE'
SqlComparison.NotLike          // 'NOT LIKE'
SqlComparison.Contains         // 'CONTAINS'
SqlComparison.StartsWith       // 'STARTS WITH'
SqlComparison.EndsWith         // 'ENDS WITH'
SqlComparison.IsNull           // 'IS NULL'
SqlComparison.IsNotNull        // 'IS NOT NULL'
```

### `SqlOperator`

Boolean join operators between filter conditions.

```ts
import { SqlOperator } from '@edium/halifax-types'

SqlOperator.And  // 'AND'
SqlOperator.Or   // 'OR'
```

### `SqlOrder`

Sort direction for `orderBy` clauses.

```ts
import { SqlOrder } from '@edium/halifax-types'

SqlOrder.ASC   // 'ASC'
SqlOrder.DESC  // 'DESC'
```

## Interfaces

### `IQueryFilter`

Represents a single filter node in the query AST. Nodes can be nested via `children` to express parenthesized boolean groups.

```ts
interface IQueryFilter {
  field: string
  comparison: string          // a SqlComparison value
  operator?: string           // a SqlOperator value — joins this node to the next sibling
  value1?: QueryScalar | QueryScalar[]
  value2?: string | number    // upper bound for BETWEEN
  children?: IQueryFilter[]   // nested group
}

type QueryScalar = string | number | boolean | null
```

### `IQueryOptions`

The full query AST sent to a `POST /<resource>/query` endpoint.

```ts
interface IQueryOptions {
  where?: IQueryFilter[]
  orderBy?: ISort[]
  limit?: number
  offset?: number
  fields?: string[]    // field projection
  distinct?: string[]  // deduplicate on these columns
}
```

### `ISort`

A single sort clause inside `IQueryOptions.orderBy`.

```ts
interface ISort {
  field: string
  order: SqlOrder
}
```

## Response types

### `ListResult<TRecord>`

Returned by `GET /<resource>`.

```ts
interface ListResult<TRecord> {
  count: number
  results: TRecord[]
}
```

### `QueryResult<TRecord>`

Returned by `POST /<resource>/query`.

```ts
interface QueryResult<TRecord> {
  count?: number
  results: TRecord[]
}
```

### `UpdateManyResult<TRecord>`

Returned by bulk `PATCH /<resource>`.

```ts
interface UpdateManyResult<TRecord> {
  updated: unknown[]
  results?: TRecord[]
}
```

### `DeleteManyResult`

Returned by bulk `DELETE /<resource>`.

```ts
interface DeleteManyResult {
  deleted: unknown[]
}
```

## Related packages

| Package | Description |
| --- | --- |
| [`@edium/halifax`](https://www.npmjs.com/package/@edium/halifax) | Server — auto-generates REST CRUD APIs from Prisma/Drizzle models |
| [`@edium/halifax-client`](https://www.npmjs.com/package/@edium/halifax-client) | Browser/Node client with query builder and TanStack Query support |
