import type { HookContext } from '@/core/hooks.js'
import type { HttpServer } from '@/core/types.js'
import { parseGetOneOptions } from '@/core/queryString.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import {
  applyHook,
  authorizeRequest,
  filterReadableFields,
  parseId,
  type RouteHandlerContext,
  wrap,
  writeSuccess
} from '@/core/handlerUtils.js'

export function registerReadOne(
  server: HttpServer,
  basePath: string,
  ctx: RouteHandlerContext
): void {
  const { resource, authStrategy, envelope, hooks, resolveRepo } = ctx
  server.registerRoute(
    'GET',
    `${basePath}/:id`,
    wrap(async (req, res) => {
      const auth = await authorizeRequest(req, resource, 'readOne', authStrategy)
      const repo = await resolveRepo(req, auth, 'readOne')
      const id = parseId(req.params['id'])
      const hookCtx: HookContext = { auth, resource, req }
      if (hooks?.beforeReadOne) await hooks.beforeReadOne(id, hookCtx)
      const { fields, include } = parseGetOneOptions(req.query, resource)
      const rawResult = await repo.getOne(id, { fields, include })
      if (!rawResult) throw new NotFoundError()
      const result = await applyHook(
        hooks?.afterReadOne,
        rawResult as Record<string, unknown>,
        hookCtx
      )
      await writeSuccess(res, 200, filterReadableFields(resource, result, auth), envelope)
    })
  )
}
