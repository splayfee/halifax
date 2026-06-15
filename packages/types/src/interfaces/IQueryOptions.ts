import type { IQueryFilter } from './IQueryFilter.js'
import type { ISort } from './ISort.js'

export interface IQueryOptions {
  distinct?: string[]
  limit?: number
  offset?: number
  fields?: string[]
  where?: IQueryFilter[]
  orderBy?: ISort[]
}
