import type { HookContext } from '@/core/hooks.js'
import type { HttpServer } from '@/core/types.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import {
  authorizeRequest,
  parseId,
  type RouteHandlerContext,
  wrap,
  writeSuccess
} from '@/core/handlerUtils.js'

export function registerDeleteOne(
  server: HttpServer,
  basePath: string,
  ctx: RouteHandlerContext
): void {
  const { resource, authStrategy, envelope, hooks, resolveRepo } = ctx
  server.registerRoute(
    'DELETE',
    `${basePath}/:id`,
    wrap(async (req, res) => {
      const auth = await authorizeRequest(req, resource, 'deleteOne', authStrategy)
      const repo = await resolveRepo(req, auth)
      const id = parseId(req.params['id'])
      const hookCtx: HookContext = { auth, resource, req }
      if (hooks?.beforeDeleteOne) await hooks.beforeDeleteOne(id, hookCtx)
      const deleted = await repo.deleteOne(id)
      if (!deleted) throw new NotFoundError()
      if (hooks?.afterDeleteOne) await hooks.afterDeleteOne(id, hookCtx)
      await writeSuccess(res, 200, { deleted: true }, envelope)
    })
  )
}
