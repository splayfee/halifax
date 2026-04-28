# What's Left

## Before publishing public 1.0.0

1. **Run full local dependency validation**
   - `pnpm install`
   - `pnpm type-check`
   - `pnpm test`
   - `pnpm build`

2. **Add real Hyper Express tests**
   - Current adapters are structurally implemented.
   - Add HTTP tests using Hyper Express as the primary dev/test server.

3. **Add SQL Server integration tests**
   - Create a small SQL Server test schema.
   - Validate query-builder `SELECT`, `COUNT`, `UPDATE`, and `DELETE` paths.
   - Gate tests behind `MSSQL_*` environment variables.

4. **Harden the Prisma adapter**
   - Validate `select` vs `include` behavior.
   - Add typed examples for `PrismaClient` delegates.
   - Decide whether `createMany` should return created records or only count by adapter capability.

5. **Harden the Sequelize adapter**
   - Validate Sequelize v6/v7 behavior.
   - Confirm MSSQL query types.
   - Confirm bulk operations and return-value behavior by dialect.

6. **Introduce repository capability flags**
   - `supportsNativeSql`
   - `supportsIncludes`
   - `supportsTransactions`
   - `supportsCreateManyReturn`
   - `supportsNoSqlQueryAst`

7. **Formalize query AST**
   - Keep JSON payload as public input.
   - Normalize it into an internal AST before compiling to SQL.
   - Add future compilers for PostgreSQL/MySQL/Mongo only after SQL Server is stable.

8. **Add include/join support intentionally**
   - Define REST syntax: `?include=posts,profile`.
   - Map includes to Prisma/Sequelize relation loading.
   - Keep SQL join compilation separate from ORM includes.

9. **Tighten field-level security**
   - Enforce `selectable`, `filterable`, `sortable`, and `writable` flags consistently.
   - Add tests proving restricted fields cannot be queried or written.

10. **Improve auth strategy examples**
    - Add Passport local/JWT bridge example.
    - Add role and permission slug tests.
    - Add Auth0 JWT example.
    - Add Firebase example.

11. **Security review**
    - Review raw SQL identifier escaping.
    - Add identifier allowlisting tests.
    - Add max limit/default limit enforcement.
    - Add query depth/cost controls before exposing advanced query endpoints publicly.
