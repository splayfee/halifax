import { HalifaxError } from '@/errors/HalifaxError.js'

describe('HalifaxError', () => {
  it('sets status, code, message, and errors from a single-item array', () => {
    const err = new HalifaxError(404, [{ code: 'NOT_FOUND', message: 'Not found' }])
    expect(err.status).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Not found')
    expect(err.errors).toHaveLength(1)
  })

  it('sets details when the first error carries one', () => {
    const err = new HalifaxError(422, [
      { code: 'INVALID', message: 'bad', details: { field: 'email' } }
    ])
    expect(err.details).toEqual({ field: 'email' })
  })

  it('details is undefined when first error omits it', () => {
    const err = new HalifaxError(400, [{ code: 'BAD', message: 'bad' }])
    expect(err.details).toBeUndefined()
  })

  it('exposes the full errors array on multi-error responses', () => {
    const errors = [
      { code: 'A', message: 'first' },
      { code: 'B', message: 'second' }
    ]
    const err = new HalifaxError(400, errors)
    expect(err.errors).toEqual(errors)
    expect(err.code).toBe('A')
    expect(err.message).toBe('first')
  })

  it('falls back gracefully when errors array is empty', () => {
    const err = new HalifaxError(500, [])
    expect(err.message).toBe('Halifax request failed')
    expect(err.code).toBe('UNKNOWN')
    expect(err.details).toBeUndefined()
  })

  it('has name "HalifaxError"', () => {
    const err = new HalifaxError(403, [{ code: 'FORBIDDEN', message: 'Forbidden' }])
    expect(err.name).toBe('HalifaxError')
  })

  it('is an instance of Error', () => {
    const err = new HalifaxError(500, [{ code: 'ERR', message: 'oops' }])
    expect(err).toBeInstanceOf(Error)
  })

  it('is an instance of HalifaxError', () => {
    const err = new HalifaxError(500, [{ code: 'ERR', message: 'oops' }])
    expect(err).toBeInstanceOf(HalifaxError)
  })
})
