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
  /** @deprecated Use repository. Included only to ease migration from the app-shaped extraction. */
  adapter?: Repository<TRecord, TCreate, TUpdate>
  requiredPermissions?: Partial<Record<CrudAction, string[]>>
}

export type { DataAdapter, Repository } from './repository.js'
export type {
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
