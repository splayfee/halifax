import type { Repository } from '@/core/repository.js'

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

export interface FieldDefinition {
  name: string
  filterable?: boolean
  sortable?: boolean
  selectable?: boolean
  writable?: boolean
}

export interface RelationDefinition {
  name: string
  includable?: boolean
}

export interface ResourceDefinition<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> {
  name: string
  routePrefix: string
  tableName?: string
  fields: FieldDefinition[]
  relations?: RelationDefinition[]
  permissions?: CrudPermissions
  repository: Repository<TRecord, TCreate, TUpdate>
  requiredPermissions?: Partial<Record<CrudAction, string[]>>
  /** Default page size when the caller omits ?limit=. No limit applied when undefined. */
  defaultLimit?: number
  /** Hard cap on page size. Requests over this are silently capped. No cap when undefined. */
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

export const defaultCrudPermissions: Required<CrudPermissions> = {
  allowCreate: false,
  allowReadOne: true,
  allowReadMany: true,
  allowReadManyWithQueryBuilder: true,
  allowUpdateOne: false,
  allowUpdateMany: false,
  allowUpsertOne: false,
  allowDeleteOne: false,
  allowDeleteMany: false
}
