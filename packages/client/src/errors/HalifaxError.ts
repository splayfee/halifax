export interface HalifaxErrorItem {
  code: string
  message: string
  details?: unknown
}

export class HalifaxError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  readonly errors: HalifaxErrorItem[]

  constructor(status: number, errors: HalifaxErrorItem[]) {
    const first = errors[0]
    super(first?.message ?? 'Halifax request failed')
    this.name = 'HalifaxError'
    this.status = status
    this.code = first?.code ?? 'UNKNOWN'
    this.details = first?.details
    this.errors = errors
  }
}
