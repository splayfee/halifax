import type { HookContext } from '@/core/hooks.js'
import type { HttpServer } from '@/core/types.js'
import {
  applyHook,
  authorizeRequest,
  filterReadableFields,
  filterWritableFields,
  getHeaderValue,
  makeReadableFieldFilter,
  type RouteHandlerContext,
  wrap,
  writeSuccess
} from '@/core/handlerUtils.js'

export function registerCreate(
  server: HttpServer,
  basePath: string,
  ctx: RouteHandlerContext
): void {
  const { resource, authStrategy, envelope, hooks, resolveRepo } = ctx
  server.registerRoute(
    'POST',
    basePath,
    wrap(async (req, res) => {
      const auth = await authorizeRequest(req, resource, 'create', authStrategy)
      const repo = await resolveRepo(req, auth, 'create')
      const idempotencyKey = getHeaderValue(req, 'idempotency-key')
      const createOptions = idempotencyKey ? { idempotencyKey } : undefined
      const hookCtx: HookContext = { auth, resource, req }
      const rawItems = (Array.isArray(req.body) ? req.body : [req.body ?? {}]).map(
        (item: Record<string, unknown>) => filterWritableFields(resource, item, auth)
      )
      const items = hooks?.beforeCreate
        ? await Promise.all(rawItems.map((d) => applyHook(hooks.beforeCreate, d, hookCtx)))
        : rawItems
      if (items.length === 1) {
        const rawResult = await repo.createOne(items[0] as never, createOptions)
        const result = await applyHook(
          hooks?.afterCreate,
          rawResult as Record<string, unknown>,
          hookCtx
        )
        await writeSuccess(res, 201, filterReadableFields(resource, result, auth), envelope)
        return
      }
      const rawResults = await repo.createMany(items as never[], createOptions)
      const results = hooks?.afterCreate
        ? await Promise.all(
            rawResults.map((r) =>
              applyHook(hooks.afterCreate, r as Record<string, unknown>, hookCtx)
            )
          )
        : (rawResults as Record<string, unknown>[])
      const filterRecord = makeReadableFieldFilter(resource, auth)
      await writeSuccess(res, 201, results.map(filterRecord), envelope)
    })
  )
}
