import { SqlOrder } from '@/enums/SqlOrder.js'

/** A single ORDER BY expression. */
export interface ISort {
  /** Column name to sort by. */
  field: string
  /** Sort direction. */
  order: SqlOrder
}
