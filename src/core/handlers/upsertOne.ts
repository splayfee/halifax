import type { HookContext } from '@/core/hooks.js'
import type { HttpServer } from '@/core/types.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { authorizeRequest } from '@/core/authUtils.js'
import { filterReadableFields, filterWritableFields } from '@/core/fieldUtils.js'
import { applyHook, parseId, type RouteHandlerContext, wrap, writeSuccess } from '@/core/handlerUtils.js'

export function registerUpsertOne(
  server: HttpServer,
  basePath: string,
  ctx: RouteHandlerContext
): void {
  const { resource, authStrategy, envelope, hooks, resolveRepo } = ctx
  server.registerRoute(
    'PUT',
    `${basePath}/:id`,
    wrap(async (req, res) => {
      const auth = await authorizeRequest(req, resource, 'upsertOne', authStrategy)
      const repo = await resolveRepo(req, auth, 'upsertOne')
      if (!repo.upsertOne) throw new NotImplementedError('This resource does not support upsert.')
      const id = parseId(req.params['id'])
      const hookCtx: HookContext = { auth, resource, req }
      const rawBody = filterWritableFields(
        resource,
        (req.body ?? {}) as Record<string, unknown>,
        auth
      )
      const body = hooks?.beforeUpsertOne
        ? ((await hooks.beforeUpsertOne(id, rawBody, hookCtx)) ?? rawBody)
        : rawBody
      const rawResult = await repo.upsertOne(id, body)
      const result = await applyHook(
        hooks?.afterUpsertOne,
        rawResult as Record<string, unknown>,
        hookCtx
      )
      await writeSuccess(res, 200, filterReadableFields(resource, result, auth), envelope)
    })
  )
}
