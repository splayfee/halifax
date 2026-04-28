import type { DataAdapter, ListOptions, ListResult } from '@/core/types.js'

export class InMemoryDataAdapter<TRecord extends Record<string, any>>
  implements DataAdapter<TRecord, Partial<TRecord>, Partial<TRecord>>
{
  private records: TRecord[]
  private readonly idField: string

  public constructor(records: TRecord[] = [], idField = 'id') {
    this.records = records
    this.idField = idField
  }

  public async getOne(id: string | number): Promise<TRecord | null> {
    return (
      this.records.find((record) => {
        return String(record[this.idField]) === String(id)
      }) ?? null
    )
  }

  public async getMany(options: ListOptions = {}): Promise<ListResult<TRecord>> {
    let results = [...this.records]

    if (options.where) {
      results = results.filter((record) => {
        return Object.entries(options.where ?? {}).every(([key, value]) => {
          if (typeof value === 'object' && value !== null && 'in' in value) {
            return (value.in as unknown[]).map(String).includes(String(record[key]))
          }
          return String(record[key]) === String(value)
        })
      })
    }

    const count = results.length

    if (options.offset !== undefined || options.limit !== undefined) {
      const start = options.offset ?? 0
      const end = options.limit !== undefined ? start + options.limit : undefined
      results = results.slice(start, end)
    }

    return { count, results }
  }

  public async createOne(data: Partial<TRecord>): Promise<TRecord> {
    const record = data as TRecord
    this.records.push(record)
    return record
  }

  public async createMany(data: Partial<TRecord>[]): Promise<TRecord[]> {
    const records = data as TRecord[]
    this.records.push(...records)
    return records
  }

  public async updateOne(id: string | number, data: Partial<TRecord>): Promise<TRecord | null> {
    const record = await this.getOne(id)
    if (!record) {
      return null
    }
    Object.assign(record, data)
    return record
  }

  public async deleteOne(id: string | number): Promise<boolean> {
    const originalLength = this.records.length
    this.records = this.records.filter((record) => {
      return String(record[this.idField]) !== String(id)
    })
    return this.records.length < originalLength
  }
}
