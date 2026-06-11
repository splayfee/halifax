import type { Repository } from '@/core/repository.js'

/** All CRUD action identifiers used for permissions and audit. */
export type CrudAction =
  | 'create'
  | 'readOne'
  | 'readMany'
  | 'readManyWithQueryBuilder'
  | 'updateOne'
  | 'updateMany'
  | 'upsertOne'
  | 'deleteOne'
  | 'deleteMany'

/** Per-action toggles controlling which CRUD endpoints are registered for a resource. */
export interface CrudPermissions {
  allowCreate?: boolean
  allowReadOne?: boolean
  allowReadMany?: boolean
  allowReadManyWithQueryBuilder?: boolean
  allowUpdateOne?: boolean
  allowUpdateMany?: boolean
  allowUpsertOne?: boolean
  allowDeleteOne?: boolean
  allowDeleteMany?: boolean
}

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
  /** Override the URL prefix (default: auto-derived kebab-plural of the model name). */
  routePrefix?: string
  /** Override the database table name. */
  tableName?: string
  /** Override the default CRUD permissions for this model. */
  permissions?: CrudPermissions
  /** Required permission strings per action for fine-grained access control. */
  requiredPermissions?: Partial<Record<CrudAction, string[]>>
  /** Default page size when the caller omits `?limit=`. */
  defaultLimit?: number
  /** Hard cap on page size. Requests above this are silently capped. */
  maxLimit?: number
  /** Maximum nesting depth for WHERE clause children (default: 3). */
  maxFilterDepth?: number
}

/** Describes a single column exposed through the Halifax API. */
export interface FieldDefinition {
  /** Column / property name. */
  name: string
  /** When `false`, the field cannot be used in `?field=` filters. */
  filterable?: boolean
  /** When `false`, the field cannot be used in `?order=` sorts. */
  sortable?: boolean
  /** When `false`, the field is excluded from `?fields=` projections. */
  selectable?: boolean
  /** When `false`, the field is stripped from POST/PATCH request bodies. */
  writable?: boolean
}

/** Describes a relation that callers may eagerly load via `?include=`. */
export interface RelationDefinition {
  /** Relation name as defined on the Prisma model. */
  name: string
  /** When `false`, this relation cannot be requested via `?include=`. */
  includable?: boolean
}

/** Full definition of a Halifax resource: its repository, field schema, routing, and permissions. */
export interface ResourceDefinition<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> {
  /** Human-readable resource name (usually the Prisma model name). */
  name: string
  /** URL path segment (e.g. `'users'`, `'blog-posts'`). */
  routePrefix: string
  /** Database table name used by the query builder. */
  tableName?: string
  /** Scalar field definitions — controls filtering, sorting, selection, and write access. */
  fields: FieldDefinition[]
  /** Relation definitions — controls `?include=` access. */
  relations?: RelationDefinition[]
  /** CRUD operation toggles. Defaults to {@link defaultCrudPermissions}. */
  permissions?: CrudPermissions
  /** The data adapter that handles reads and writes for this resource. */
  repository: Repository<TRecord, TCreate, TUpdate>
  /** Required permission strings per action (checked by the auth strategy). */
  requiredPermissions?: Partial<Record<CrudAction, string[]>>
  /** Default page size when the caller omits `?limit=`. No limit applied when `undefined`. */
  defaultLimit?: number
  /** Hard cap on page size. Requests over this are silently capped. No cap when `undefined`. */
  maxLimit?: number
  /** Maximum nesting depth for WHERE clause children. Defaults to 3. */
  maxFilterDepth?: number
}

export type { Repository, RepositoryCapabilities } from './repository.js'
export type {
  CreateOptions,
  ListOptions,
  ListResult,
  DeleteManyResult,
  UpdateManyResult,
  NativeQueryResult
} from './repository.js'

/** Default permissions applied to every resource — all CRUD operations enabled. */
export const defaultCrudPermissions: Required<CrudPermissions> = {
  allowCreate: true,
  allowReadOne: true,
  allowReadMany: true,
  allowReadManyWithQueryBuilder: true,
  allowUpdateOne: true,
  allowUpdateMany: true,
  allowUpsertOne: true,
  allowDeleteOne: true,
  allowDeleteMany: true
}
