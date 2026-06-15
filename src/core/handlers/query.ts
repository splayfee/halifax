import type { IQueryOptions } from '@edium/halifax-types'
import type { HookContext } from '@/core/hooks.js'
import type { HttpServer, ListResult } from '@/core/types.js'
import { validateAdvancedQuery } from '@/core/validation.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import {
  applyHook,
  authorizeRequest,
  makeReadableFieldFilter,
  type RouteHandlerContext,
  wrap,
  writeSuccess
} from '@/core/handlerUtils.js'

export function registerQuery(
  server: HttpServer,
  basePath: string,
  queryBuilderPath: string,
  ctx: RouteHandlerContext
): void {
  const { resource, authStrategy, envelope, hooks, resolveRepo } = ctx
  server.registerRoute(
    'POST',
    `${basePath}/${queryBuilderPath}`,
    wrap(async (req, res) => {
      const auth = await authorizeRequest(req, resource, 'readManyWithQueryBuilder', authStrategy)
      const repo = await resolveRepo(req, auth)
      if (!repo.executeQuery)
        throw new NotImplementedError('This resource does not support the query builder.')
      const hookCtx: HookContext = { auth, resource, req }
      const body = (req.body ?? {}) as Record<string, unknown>
      const parsedQuery = { ...body } as IQueryOptions
      const query = await applyHook(hooks?.beforeQuery, parsedQuery, hookCtx)
      validateAdvancedQuery(resource, query)
      const rawResult = await repo.executeQuery(query)
      const result = await applyHook(
        hooks?.afterQuery,
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
