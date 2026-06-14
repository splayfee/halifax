import type { IQueryOptions } from '@edium/halifax-types'
import type { HookContext } from '@/core/hooks.js'
import type { HttpServer, UpdateManyResult } from '@/core/types.js'
import { validateAdvancedQuery } from '@/core/validation.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'
import {
  applyHook,
  authorizeRequest,
  filterReadableFields,
  filterWritableFields,
  type RouteHandlerContext,
  wrap,
  writeSuccess
} from '@/core/handlerUtils.js'

export function registerUpdateMany(
  server: HttpServer,
  basePath: string,
  ctx: RouteHandlerContext
): void {
  const { resource, authStrategy, envelope, hooks, resolveRepo } = ctx
  server.registerRoute(
    'PATCH',
    basePath,
    wrap(async (req, res) => {
      const auth = await authorizeRequest(req, resource, 'updateMany', authStrategy)
      const repo = await resolveRepo(req, auth)
      if (!repo.updateMany)
        throw new NotImplementedError('This resource does not support updateMany.')
      const hookCtx: HookContext = { auth, resource, req }
      const { update, ...queryBody } = (req.body ?? {}) as Record<string, unknown>
      const filteredUpdate = filterWritableFields(
        resource,
        (update ?? {}) as Record<string, unknown>,
        auth
      )
      if (!Object.keys(filteredUpdate).length)
        throw new UnprocessableEntityError(
          'updateMany requires at least one writable field in the update payload.'
        )
      const query = { ...queryBody } as IQueryOptions
      validateAdvancedQuery(resource, query)
      if (!query.where?.length)
        throw new UnprocessableEntityError(
          'updateMany requires at least one WHERE filter to prevent unintended bulk updates.'
        )
      if (hooks?.beforeUpdateMany) await hooks.beforeUpdateMany(query, filteredUpdate, hookCtx)
      const rawResult = await repo.updateMany(query, filteredUpdate as never)
      const result = await applyHook(
        hooks?.afterUpdateMany,
        rawResult as UpdateManyResult<Record<string, unknown>>,
        hookCtx
      )
      await writeSuccess(
        res,
        200,
        {
          ...result,
          ...(result.results
            ? {
                results: result.results.map((r) =>
                  filterReadableFields(resource, r as Record<string, unknown>, auth)
                )
              }
            : {})
        },
        envelope
      )
    })
  )
}
