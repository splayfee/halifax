import type { ModelSchema, ModelResourceOptions, CrudPermissions } from '@/core/types.js'

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

/** Minimal Prisma client interface needed for raw SQL execution. */
export interface PrismaNativeClient {
  $queryRawUnsafe?<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe?<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

/** Construction options for {@link PrismaAdapter}. */
export interface PrismaAdapterOptions {
  delegate: PrismaDelegate
  client?: PrismaNativeClient
  idField?: string
  tableName?: string
  returnCreated?: boolean
  model?: ModelSchema
}

/** Global options for {@link createPrismaResources}. */
export interface CreatePrismaResourcesOptions {
  models?: Record<string, ModelResourceOptions>
  permissions?: CrudPermissions
  defaultLimit?: number
  maxLimit?: number
  idField?: string
  returnCreated?: boolean
}
