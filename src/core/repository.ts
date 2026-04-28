import type { IQueryOptions } from '@/interfaces/IQueryOptions.js'

export interface ListOptions {
  fields?: string[] | undefined
  where?: Record<string, unknown>
  limit?: number | undefined
  offset?: number | undefined
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }> | undefined
  include?: string[] | undefined
}

export interface ListResult<TRecord> {
  count: number
  results: TRecord[]
}

export interface DeleteManyResult {
  deleted: unknown[]
}

export interface UpdateManyResult<TRecord> {
  updated: unknown[]
  results?: TRecord[]
}

export interface NativeQueryResult<TRecord> {
  count?: number
  results: TRecord[]
}

export interface Repository<TRecord = unknown, TCreate = Partial<TRecord>, TUpdate = Partial<TRecord>> {
  getOne(id: string | number, options?: Pick<ListOptions, 'fields' | 'include'>): Promise<TRecord | null>
  getMany(options?: ListOptions): Promise<ListResult<TRecord>>
  createOne(data: TCreate): Promise<TRecord>
  createMany(data: TCreate[]): Promise<TRecord[]>
  updateOne(id: string | number, data: TUpdate): Promise<TRecord | null>
  updateMany?(query: IQueryOptions, data: TUpdate): Promise<UpdateManyResult<TRecord>>
  upsertOne?(id: string | number, data: TCreate & TUpdate): Promise<TRecord>
  deleteOne(id: string | number): Promise<boolean>
  deleteMany?(query: IQueryOptions): Promise<DeleteManyResult>
  executeQueryBuilder?(query: IQueryOptions): Promise<NativeQueryResult<TRecord>>
}

export type DataAdapter<TRecord = unknown, TCreate = Partial<TRecord>, TUpdate = Partial<TRecord>> = Repository<
  TRecord,
  TCreate,
  TUpdate
>
