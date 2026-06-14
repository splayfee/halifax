export type QueryScalar = string | number | boolean | null

export interface IQueryFilter {
  comparison: string
  field: string
  operator?: string
  value1?: QueryScalar | QueryScalar[]
  value2?: string | number
  children?: IQueryFilter[]
}
