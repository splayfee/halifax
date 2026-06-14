export interface ListResult<TRecord> {
  count: number
  results: TRecord[]
}

export interface QueryResult<TRecord> {
  count?: number
  results: TRecord[]
}

export interface UpdateManyResult<TRecord> {
  updated: unknown[]
  results?: TRecord[]
}

export interface DeleteManyResult {
  deleted: unknown[]
}
