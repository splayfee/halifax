import type { HookContext } from '@/core/hooks.js'
import type { HttpServer, ListResult } from '@/core/types.js'
import { parseListOptions } from '@/core/queryString.js'
import {
  applyHook,
  authorizeRequest,
  makeReadableFieldFilter,
  type RouteHandlerContext,
  wrap,
  writeSuccess
} from '@/core/handlerUtils.js'

export function registerReadMany(
  server: HttpServer,
  basePath: string,
  ctx: RouteHandlerContext
): void {
  const { resource, authStrategy, envelope, hooks, resolveRepo } = ctx
  server.registerRoute(
    'GET',
    basePath,
    wrap(async (req, res) => {
      const auth = await authorizeRequest(req, resource, 'readMany', authStrategy)
      const repo = await resolveRepo(req, auth)
      const hookCtx: HookContext = { auth, resource, req }
      const parsedOptions = parseListOptions(req.query, resource)
      const listOptions = await applyHook(hooks?.beforeReadMany, parsedOptions, hookCtx)
      const rawResult = await repo.getMany(listOptions)
      const result = await applyHook(
        hooks?.afterReadMany,
        rawResult as ListResult<Record<string, unknown>>,
        hookCtx
      )
      const filterRecord = makeReadableFieldFilter(resource, auth)
      await writeSuccess(
        res,
        200,
        { ...result, results: result.results.map(filterRecord) },
        envelope
      )
    })
  )
}
