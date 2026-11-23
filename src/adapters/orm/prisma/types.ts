import type {
  ModelSchema,
  ModelResourceOptions,
  CrudPermissions,
  TenantScope
} from '@/core/types.js'

/**
 * Minimal Prisma delegate interface needed for CRUD operations. This is not a full Prisma client,
 * but only the methods required by the adapter. The actual Prisma client will have more methods
 * and properties, but these are the ones that the adapter will use.
 */
export interface PrismaDelegate {
  findUnique?(args: unknown): Promise<unknown>
  findFirst?(args: unknown): Promise<unknown>
  findMany(args?: unknown): Promise<unknown[]>
  count(args?: unknown): Promise<number>
  create(args: unknown): Promise<unknown>
  createMany?(args: unknown): Promise<{ count: number }>
  update(args: unknown): Promise<unknown>
  updateMany?(args: unknown): Promise<{ count: number }>
  upsert?(args: unknown): Promise<unknown>
  delete(args: unknown): Promise<unknown>
  deleteMany?(args: unknown): Promise<{ count: number }>
}

/** Construction options for {@link PrismaAdapter}. */
export interface PrismaAdapterOptions {
  delegate: PrismaDelegate
  idField?: string
  returnCreated?: boolean
  model?: ModelSchema
  /**
   * Whether the database accepts Prisma's `mode: 'insensitive'`, which `ICONTAINS`,
   * `ISTARTS WITH` and `IENDS WITH` need on PostgreSQL, CockroachDB and MongoDB. Defaults to
   * `true`. Set it to `false` on MySQL, MariaDB, SQL Server and SQLite, which reject `mode` and
   * whose plain string operators already ignore case. {@link createPrismaResources} sets it
   * from the client's provider.
   */
  insensitiveMode?: boolean
  /**
   * Tenant constraint bound to this adapter instance. Set indirectly via
   * {@link PrismaAdapter.withScope}; when present, every operation is confined to
   * `scope.value` on `scope.field`. Leave undefined for unscoped (global) access.
   */
  scope?: TenantScope
}

/** Global options for {@link createPrismaResources}. */
export interface CreatePrismaResourcesOptions {
  models?: Record<string, ModelResourceOptions>
  permissions?: CrudPermissions
  defaultLimit?: number
  maxLimit?: number
  idField?: string
  returnCreated?: boolean
  /**
   * Tenant column to scope on. Every generated resource that has a scalar field with
   * this name is marked tenant-scoped on it (`resource.tenant = { field }`), unless the
   * model overrides or opts out via {@link ModelResourceOptions.tenant}. Pair this with
   * the API-level `tenant` option (the value resolver) to enforce isolation.
   */
  tenantField?: string
}
