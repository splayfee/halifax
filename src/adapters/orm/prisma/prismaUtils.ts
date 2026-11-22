import type { FieldType } from '@/core/types.js'

/** Returns true for Prisma's P2025 "record not found" error. */
export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Record<string, unknown>).code === 'P2025'
  )
}

/** Returns true for Prisma's P2002 unique constraint violation. */
export function isDuplicateError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Record<string, unknown>).code === 'P2002'
  )
}

/** SQL Server's error number for an explicit value inserted into an IDENTITY column. */
const MSSQL_IDENTITY_INSERT_OFF = 544

/**
 * Returns true for SQL Server's "IDENTITY_INSERT is set to OFF" error (code 544).
 * MSSQL IDENTITY columns reject any explicit-value INSERT via the driver adapter rather
 * than surfacing a P2002 duplicate — so this must be caught separately. Prisma up to 7.8 puts the
 * driver's error on `cause`; 7.10 wraps it as a P2039 with the driver's error under
 * `meta.driverAdapterError.cause`, so both places are checked.
 */
export function isIdentityInsertError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as {
    cause?: { code?: unknown }
    meta?: { driverAdapterError?: { cause?: { code?: unknown } } }
  }
  return (
    e.cause?.code === MSSQL_IDENTITY_INSERT_OFF ||
    e.meta?.driverAdapterError?.cause?.code === MSSQL_IDENTITY_INSERT_OFF
  )
}

/** Maps a Prisma scalar type name to its OpenAPI equivalent type + format. */
export function prismaTypeToOpenApi(prismaType?: string): { type?: FieldType; format?: string } {
  switch (prismaType) {
    case 'Int':
      return { type: 'integer', format: 'int32' }
    case 'BigInt':
      return { type: 'integer', format: 'int64' }
    case 'Float':
      return { type: 'number', format: 'float' }
    case 'Decimal':
      return { type: 'number', format: 'double' }
    case 'Boolean':
      return { type: 'boolean' }
    case 'DateTime':
      return { type: 'string', format: 'date-time' }
    case 'Json':
      return { type: 'object' }
    case 'Bytes':
      return { type: 'string', format: 'binary' }
    default:
      return {}
  }
}
