import { SqlOrder } from '../../enums/SqlOrder.js'

export interface ISort {
  field: string
  order: SqlOrder
}
