# What's Left

## Before publishing public 1.0.0

3. **Harden the Prisma adapter**
   - Validate `select` vs `include` behavior.
   - Add typed examples for `PrismaClient` delegates.
   - Decide whether `createMany` should return created records or only count by adapter capability.

4. **Introduce repository capability flags**
   - `supportsNativeSql`
   - `supportsIncludes`
   - `supportsTransactions`
   - `supportsCreateManyReturn`
   - `supportsNoSqlQueryAst`

5. **Formalize query AST**
   - Keep JSON payload as public input.
   - Normalize it into an internal AST before compiling to SQL.

6. **Add include/join support intentionally**
   - Define REST syntax: `?include=posts,profile`.
   - Map includes to Prisma relation loading.
   - Keep SQL join compilation separate from ORM includes.

7. **Tighten field-level security**
   - Enforce `selectable`, `filterable`, `sortable`, and `writable` flags consistently.
   - Add tests proving restricted fields cannot be queried or written.

8. **Improve auth strategy examples**
   - Add Passport local/JWT bridge example.
   - Add role and permission slug tests.

9. **Security review**
   - Review raw SQL identifier escaping.
   - Add identifier allowlisting tests.
   - Add max limit/default limit enforcement.
   - Add query depth/cost controls before exposing advanced query endpoints publicly.
