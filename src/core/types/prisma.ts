import type { TenantResourceConfig } from './field.js'
import type { CrudAction, CrudPermissions } from './resource.js'

/** Minimal shape of a Prisma DMMF field — structurally compatible with `Prisma.DMMF.Field`. */
export interface ModelField {
  /** Column / property name. */
  name: string
  /** Prisma field kind: `'scalar'`, `'object'` (relation), `'enum'`, or `'unsupported'`. */
  kind: string
  /** True when this field is the model's primary key. */
  isId: boolean
  /** True for fields that are auto-managed by Prisma (e.g. relation FKs, read-only scalars). */
  isReadOnly: boolean
  /** True when Prisma provides a default value (e.g. `@default(autoincrement())`). */
  hasDefault: boolean
  /** Prisma scalar type name (e.g. `'String'`, `'Int'`, `'Boolean'`, `'DateTime'`). Used for OpenAPI type inference. */
  type?: string
}

/** Minimal shape of a Prisma DMMF model — structurally compatible with `Prisma.DMMF.Model`. */
export interface ModelSchema {
  /** Prisma model name (PascalCase). */
  name?: string
  /** Underlying database table name, or `null` to use the model name. */
  dbName?: string | null
  fields: ModelField[]
}

/** Per-model overrides for {@link createPrismaResources}. */
export interface ModelResourceOptions {
  /** When true, this model is skipped entirely. */
  exclude?: boolean
  /**
   * Tenant isolation for this model. Set `{ field }` to scope on a specific column,
   * or `false` to opt this model out of an otherwise tenant-scoped API. When omitted,
   * the model is auto-scoped if the API's default tenant field exists on it.
   */
  tenant?: TenantResourceConfig | false
  /** Override the URL prefix (default: auto-derived kebab-plural of the model name). */
  routePrefix?: string
  /** Override the default CRUD permissions for this model. */
  permissions?: CrudPermissions
  /** Required permission strings per action for fine-grained access control. */
  requiredPermissions?: Partial<Record<CrudAction, string[]>>
  /** Default page size when the caller omits `?limit=`. */
  defaultLimit?: number
  /** Hard cap on page size. Requests above this are silently capped. */
  maxLimit?: number
  /** Maximum nesting depth for WHERE clause children (default: 4). */
  maxFilterDepth?: number
}
