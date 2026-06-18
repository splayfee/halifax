import { HttpError } from '@/errors/HttpError.js'
import type { HttpResponse } from '@/core/types.js'

/** Maps HTTP status codes to machine-readable error code strings. */
export const statusCodeMap: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  409: 'CONFLICT',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  501: 'NOT_IMPLEMENTED'
}

/**
 * Converts any thrown value to a structured `{ status, code, message, details }` object.
 * {@link HttpError} subclasses preserve their status; all other errors become 500.
 */
export function normalizeError(error: unknown): {
  status: number
  code: string
  message: string
  details?: unknown
} {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      code: statusCodeMap[error.status] ?? 'INTERNAL_ERROR',
      message: error.message,
      details: error.details
    }
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' }
}

/**
 * Serialises a caught error and writes it as a JSON `{ errors: [...] }` response.
 */
export async function sendError(error: unknown, res: HttpResponse): Promise<void> {
  const { status, code, message, details } = normalizeError(error)
  const item: Record<string, unknown> = { code, message }
  if (details !== undefined) item['details'] = details
  await res.status(status).json({ errors: [item] })
}
