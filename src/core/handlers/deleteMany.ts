import type { IQueryOptions } from '@edium/halifax-types'
import type { HookContext } from '@/core/hooks.js'
import type { HttpServer } from '@/core/types.js'
import { validateAdvancedQuery } from '@/core/validation.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'
import {
  applyHook,
  authorizeRequest,
  type RouteHandlerContext,
  wrap,
  writeSuccess
} from '@/core/handlerUtils.js'

export function registerDeleteMany(
  server: HttpServer,
  basePath: string,
  ctx: RouteHandlerContext
): void {
  const { resource, authStrategy, envelope, hooks, resolveRepo } = ctx
  server.registerRoute(
    'DELETE',
    basePath,
    wrap(async (req, res) => {
      const auth = await authorizeRequest(req, resource, 'deleteMany', authStrategy)
      const repo = await resolveRepo(req, auth, 'deleteMany')
      if (!repo.deleteMany)
        throw new NotImplementedError('This resource does not support deleteMany.')
      const hookCtx: HookContext = { auth, resource, req }
      const body = (req.body ?? {}) as Record<string, unknown>
      const query = { ...body } as IQueryOptions
      validateAdvancedQuery(resource, query)
      if (!query.where?.length)
        throw new UnprocessableEntityError(
          'deleteMany requires at least one WHERE filter to prevent unintended bulk deletes.'
        )
      if (hooks?.beforeDeleteMany) await hooks.beforeDeleteMany(query, hookCtx)
      const rawResult = await repo.deleteMany(query)
      const result = await applyHook(hooks?.afterDeleteMany, rawResult, hookCtx)
      await writeSuccess(res, 200, result, envelope)
    })
  )
}
