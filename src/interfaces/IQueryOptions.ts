import { IQueryFilter } from './IQueryFilter.js'
import { ISort } from './ISort.js'

export interface IQueryOptions {
  isDistinct?: boolean
  limit?: number
  offset?: number
  fields?: string[]
  tableName: string
  where?: IQueryFilter[]
  orderBy?: ISort[]
  returnDefaults?: boolean
  view?: string
}
