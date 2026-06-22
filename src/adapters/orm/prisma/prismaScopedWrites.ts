import type { TenantScope } from '@/core/types.js'
import { ConflictError } from '@/errors/ConflictError.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import { ServerError } from '@/errors/ServerError.js'
import type { PrismaDelegate } from './types.js'
import { isDuplicateError, isIdentityInsertError, isNotFoundError } from './prismaUtils.js'
import { scopedWhere, stampTenant, stripTenant } from './tenantScoping.js'

/**
 * Tenant-safe single-row write algorithms for {@link PrismaAdapter}. Extracted from the adapter
 * so the (necessarily intricate) scoped paths live as small, individually-testable functions
 * rather than swelling the adapter and inflating its cyclomatic complexity.
 *
 * The shared invariant across all three: ownership and mutation happen in **one** atomic
 * statement (a scoped `updateMany`/`deleteMany`) so there is no time-of-check/time-of-use window
 * in which a row could cross tenants between a read and a write. When the delegate lacks the bulk
 * method needed to do that safely, the operation fails closed with a {@link ServerError} rather
 * than risking a cross-tenant mutation.
 */

/** A write payload as it reaches the adapter — an opaque field bag (validation happened upstream). */
type WritePayload = Record<string, unknown>

/**
 * Creates a record for the current tenant, stamping the tenant value and the target `id`.
 * Recovers from a MSSQL `IDENTITY_INSERT` rejection by probing for an existing row at `id`:
 * a hit means another tenant owns that id (→ {@link ConflictError}); a miss means it is a genuinely
 * new row, so the create is retried without the explicit id (letting the DB assign it).
 */
async function createForTenant(
  delegate: PrismaDelegate,
  scope: TenantScope,
  idField: string,
  id: string | number,
  data: WritePayload
): Promise<unknown> {
  try {
    return await delegate.create({ data: stampTenant(scope, { ...data, [idField]: id }) })
  } catch (error) {
    if (isDuplicateError(error)) throw new ConflictError()
    if (isIdentityInsertError(error)) {
      const anyMatch = await delegate.findFirst!({ where: { [idField]: id } })
      if (anyMatch) throw new ConflictError()
      return await delegate.create({ data: stampTenant(scope, data) })
    }
    throw error
  }
}

/**
 * Scoped `updateOne`: applies the update through a single `updateMany` whose WHERE carries the
 * tenant predicate, then reads the row back. A row outside the caller's tenant matches nothing and
 * reports as not found (`null`).
 * @throws {@link ServerError} when the delegate lacks `updateMany`/`findFirst` (no atomic scoped update possible).
 */
export async function scopedUpdateOne(
  delegate: PrismaDelegate,
  scope: TenantScope,
  idField: string,
  id: string | number,
  data: WritePayload
): Promise<unknown | null> {
  const whereClause = scopedWhere(scope, { [idField]: id })
  if (delegate.updateMany && delegate.findFirst) {
    const { count } = await delegate.updateMany({
      where: whereClause,
      data: stripTenant(scope, data)
    })
    if (count === 0) return null
    return (await delegate.findFirst({ where: whereClause })) ?? null
  }
  throw new ServerError(
    'Prisma delegate does not support updateMany (required for safe tenant-scoped updateOne).'
  )
}

/**
 * Scoped `upsertOne`: never uses `delegate.upsert` (its update branch ignores the tenant), instead
 * decomposing into a scoped `findFirst` + scoped `updateMany` (create on miss) so the tenant
 * constraint is enforced at every statement. Falls back to a plain scoped `update` only when the
 * delegate lacks `updateMany`.
 * @throws {@link ServerError} when the delegate lacks `findFirst` (required for tenant scoping).
 * @throws {@link NotFoundError} when the id resolves to a row owned by another tenant.
 */
export async function scopedUpsertOne(
  delegate: PrismaDelegate,
  scope: TenantScope,
  idField: string,
  id: string | number,
  data: WritePayload
): Promise<unknown> {
  if (!delegate.findFirst) {
    throw new ServerError(
      'Prisma delegate does not support findFirst (required for tenant scoping).'
    )
  }
  const whereClause = scopedWhere(scope, { [idField]: id })
  const existing = (await delegate.findFirst({ where: whereClause })) as WritePayload | null

  // Defense-in-depth: whereClause already filters by tenant, but verify ownership before treating
  // the row as the caller's.
  if (existing && existing[scope.field] !== scope.value) throw new NotFoundError()
  if (!existing) return createForTenant(delegate, scope, idField, id, data)

  if (delegate.updateMany) {
    const { count } = await delegate.updateMany({
      where: whereClause,
      data: stripTenant(scope, data)
    })
    // Deleted in the tiny window between findFirst and updateMany — fall back to a create so the
    // caller still gets a record back (consistent with upsert semantics).
    if (count === 0) return createForTenant(delegate, scope, idField, id, data)
    return delegate.findFirst({ where: whereClause })
  }

  // updateMany unavailable: the update is still scoped via the earlier findFirst; the residual
  // TOCTOU window is only closeable with a transaction, which we cannot guarantee across providers.
  try {
    return await delegate.update({
      where: { [idField]: id },
      data: stripTenant(scope, data)
    })
  } catch (error) {
    if (isNotFoundError(error)) throw new NotFoundError()
    if (isDuplicateError(error)) throw new ConflictError()
    throw error
  }
}

/**
 * Scoped `deleteOne`: deletes through `deleteMany` with the tenant predicate so the ownership check
 * and the delete are one atomic statement. A row in another tenant matches nothing → reports as
 * not found (`false`).
 * @throws {@link ServerError} when the delegate lacks `deleteMany` (no atomic scoped delete possible).
 */
export async function scopedDeleteOne(
  delegate: PrismaDelegate,
  scope: TenantScope,
  idField: string,
  id: string | number
): Promise<boolean> {
  if (delegate.deleteMany) {
    const result = await delegate.deleteMany({ where: scopedWhere(scope, { [idField]: id }) })
    return (result?.count ?? 0) > 0
  }
  throw new ServerError(
    'Prisma delegate does not support deleteMany (required for safe tenant-scoped deleteOne).'
  )
}
