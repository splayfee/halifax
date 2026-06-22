# Halifax — Stored-Procedure Endpoints

Some work belongs in the database: a reporting `GROUP BY`/`HAVING`, a set-based recalculation, a
routine that already encapsulates business logic. Configure `execute` and Halifax turns **each
registered stored procedure into its own auto-documented `POST` endpoint** — with a typed request
body, validation, role gating, and OpenAPI generated from the procedure's declared parameters.

It is **off by default** (like the GraphQL endpoint): routes exist only when you supply `execute`.

## Quick start

```ts
import { registerCrudApi, ExpressHttpServer, PrismaSqlExecutor } from '@edium/halifax'
import { Router } from 'express'

const router = Router()
registerCrudApi(new ExpressHttpServer(router), resources, {
  authStrategy,
  execute: {
    executor: new PrismaSqlExecutor(prisma), // or new DrizzleSqlExecutor(db)
    procedures: [
      {
        name: 'get_report', // → POST /execute/get-report  (kebab-cased from the SP name)
        params: [
          { name: 'year', type: 'number', required: true },
          { name: 'quarter', type: 'string', required: true },
          { name: 'tags', type: 'string[]', required: false }
        ],
        roles: ['reports:read']
      },
      { name: 'recalc_balances', roles: ['admin'] } // → POST /execute/recalc-balances
    ]
  }
})
app.use('/api/v2', router)
```

```http
POST /api/v2/execute/get-report
Content-Type: application/json

{ "year": 2026, "quarter": "Q2", "tags": ["west", "east"] }
```

```json
{ "rows": [{ "category": "lines", "total": 42 }], "rowCount": 1 }
```

## One endpoint per procedure

Each entry in `procedures` becomes its own route:

- **Path** defaults to the **kebab-cased** routine name (`get_report` / `getReport` → `/execute/get-report`),
  under `basePath` (default `/execute`).
- **Override** per procedure with `path`: a value without a leading `/` is a segment under `basePath`
  (`path: 'sales-summary'` → `/execute/sales-summary`); a value starting with `/` is the full route
  path (`path: '/reports/summary'` → `/reports/summary`).
- `name` (the database routine) is **required** and is what's actually invoked in SQL.

Because every procedure is a distinct route, **an unregistered name simply doesn't exist → a clean
`404`** (never a `405` from a catch-all). There is no generic dispatch endpoint to probe.

## Typed, named parameters

Declare parameters as an ordered list; the **order is the positional binding order** (`$1..$n`),
while the **request body is a JSON object keyed by the parameter `name`s**:

```ts
params: [
  { name: 'year', type: 'number', required: true },
  { name: 'region', type: 'string' }, // required defaults to true
  { name: 'skus', type: 'string[]', required: false }
]
```

`type` ∈ `'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]'` (default
`'string'`). The body is validated against the declarations and the values are then bound positionally
in declared order. A request is rejected with **`422 Unprocessable Entity`** (with a
`details.fieldErrors` list) when a parameter is:

- **missing** and `required` (the default),
- an **unknown** key not in the declarations, or
- the **wrong type**.

> Status code note: validation failures return **422** (consistent with the rest of Halifax's
> validation), not 405 — `405 Method Not Allowed` is about HTTP verbs and would be misleading here.

## Security

- Each procedure takes its own `roles` (OR-match), so you can gate every stored procedure
  independently. `roles: []` = any authenticated caller; a non-empty array = must hold one;
  `roles: null` = public. A procedure with no `roles` inherits `execute.roles` (default `[]`).
- The procedure `name` is never built from request input — it's your declared value, re-validated as
  a plain (optionally schema-qualified) SQL identifier and quoted before use; params are always bound.

## Rows or void — it "just works"

The shipped executors handle routines that return a result set **and** routines that return nothing:

- **MySQL** — `CALL name(?, …)`.
- **SQL Server** — `EXEC name @P1, … ` (stored procedures return their result sets directly).
- **PostgreSQL** — `SELECT * FROM name($1, …)` (functions); if the routine is a `PROCEDURE`
  (SQLSTATE `42809`), it transparently retries as `CALL name($1, …)` and returns an empty row set.
  The classification is cached per name.

```ts
new PrismaSqlExecutor(prisma) // dialect auto-detected from the client
new PrismaSqlExecutor(prisma, { dialect: 'mssql' }) // or set it explicitly
new DrizzleSqlExecutor(db, { dialect: 'postgres' }) // Drizzle: postgres | mysql only
```

> **Caveat (PostgreSQL).** A pure PG `PROCEDURE` invoked via `CALL` returns no result set, so `rows`
> is `[]` (use `INOUT` params or a `FUNCTION` if you need values back). Functions return rows on every
> dialect; MySQL procedures return their result sets normally.

### Database support matrix

The shipped executors target the SQL dialects that have first-class stored routines:

| Database        | Prisma `provider` | Dialect           | Stored procedures                                                |
| --------------- | ----------------- | ----------------- | ---------------------------------------------------------------- |
| PostgreSQL      | `postgresql`      | `postgres` (auto) | ✅ functions + `CALL` procedures                                 |
| MySQL           | `mysql`           | `mysql` (auto)    | ✅ `CALL` procedures                                             |
| MariaDB         | `mysql`           | `mysql` (auto)    | ✅ `CALL` procedures                                             |
| SQL Server      | `sqlserver`       | `mssql` (auto)    | ✅ `EXEC` procedures (Prisma only — Drizzle has no MSSQL driver) |
| CockroachDB     | `cockroachdb`     | `postgres` (auto) | ⚠️ UDFs/procedures only on recent CockroachDB versions           |
| SQLite / LibSQL | `sqlite`          | —                 | ➖ N/A — SQLite has no stored routines (executor throws)         |

`PrismaSqlExecutor` auto-detects the dialect from the client's active provider (Postgres, MySQL,
MariaDB, SQL Server, CockroachDB); for SQLite — or any unrecognized provider — it throws a clear
error rather than guessing. `DrizzleSqlExecutor` supports `postgres` (default) and `mysql` only —
Drizzle has no SQL Server driver. For an unsupported engine, supply your own `SqlExecutor`.

## OpenAPI

When OpenAPI is enabled, every procedure route is documented automatically: the request body schema
is generated from its declared parameters (names, types, `required` list), and the response is the
`{ rows, rowCount }` shape. No hand-written spec metadata.

## Custom executors

Any object implementing `SqlExecutor` works — point it at a read replica, a different driver, or a
non-SQL backend:

```ts
interface SqlExecutor {
  call(name: string, params: ExecuteValue[]): Promise<unknown[]> // ExecuteValue = string|number|boolean|[]
}
```
