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
  findUnique?(args: any): Promise<any>
  findFirst?(args: any): Promise<any>
  findMany(args?: any): Promise<any[]>
  count(args?: any): Promise<number>
  create(args: any): Promise<any>
  createMany?(args: any): Promise<{ count: number }>
  update(args: any): Promise<any>
  updateMany?(args: any): Promise<{ count: number }>
  upsert?(args: any): Promise<any>
  delete(args: any): Promise<any>
  deleteMany?(args: any): Promise<{ count: number }>
}

/** Construction options for {@link PrismaAdapter}. */
export interface PrismaAdapterOptions {
  delegate: PrismaDelegate
  idField?: string
  returnCreated?: boolean
  model?: ModelSchema
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
