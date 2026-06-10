import type { IQueryFilter } from '@/interfaces/IQueryFilter.js'
import type { ISort } from '@/interfaces/ISort.js'

export interface IQueryOptions {
  isDistinct?: boolean
  limit?: number
  offset?: number
  fields?: string[]
  tableName?: string
  where?: IQueryFilter[]
  orderBy?: ISort[]
}
