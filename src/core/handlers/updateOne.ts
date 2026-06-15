import type { HookContext } from '@/core/hooks.js'
import type { HttpServer } from '@/core/types.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import {
  applyHook,
  authorizeRequest,
  filterReadableFields,
  filterWritableFields,
  parseId,
  type RouteHandlerContext,
  wrap,
  writeSuccess
} from '@/core/handlerUtils.js'

export function registerUpdateOne(
  server: HttpServer,
  basePath: string,
  ctx: RouteHandlerContext
): void {
  const { resource, authStrategy, envelope, hooks, resolveRepo } = ctx
  server.registerRoute(
    'PATCH',
    `${basePath}/:id`,
    wrap(async (req, res) => {
      const auth = await authorizeRequest(req, resource, 'updateOne', authStrategy)
      const repo = await resolveRepo(req, auth)
      const id = parseId(req.params['id'])
      const hookCtx: HookContext = { auth, resource, req }
      const rawBody = filterWritableFields(resource, (req.body ?? {}) as Record<string, unknown>, auth)
      const body = hooks?.beforeUpdateOne
        ? ((await hooks.beforeUpdateOne(id, rawBody, hookCtx)) ?? rawBody)
        : rawBody
      const rawResult = await repo.updateOne(id, body as never)
      if (!rawResult) throw new NotFoundError()
      const result = await applyHook(
        hooks?.afterUpdateOne,
        rawResult as Record<string, unknown>,
        hookCtx
      )
      await writeSuccess(res, 200, filterReadableFields(resource, result, auth), envelope)
    })
  )
}
