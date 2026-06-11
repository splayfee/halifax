import type { ModelField, ResourceDefinition } from '@/core/types.js'
import type { CreatePrismaResourcesOptions, PrismaDelegate, PrismaNativeClient } from './types.js'
import { PrismaAdapter } from './PrismaAdapter.js'
import { toRoutePrefix } from './helpers.js'

export function createPrismaResources(
  prismaClient: object,
  schema: ReadonlyArray<{ name: string; dbName?: string | null; fields: ModelField[] }>,
  options: CreatePrismaResourcesOptions = {}
): ResourceDefinition[] {
  const client = prismaClient as any

  return schema
    .filter((model) => !options.models?.[model.name]?.exclude)
    .map((model) => {
      const modelOpts = options.models?.[model.name] ?? {}
      const tableName = modelOpts.tableName ?? model.dbName ?? model.name
      const routePrefix = modelOpts.routePrefix ?? toRoutePrefix(model.name)
      const delegateKey = model.name.charAt(0).toLowerCase() + model.name.slice(1)

      const adapter = new PrismaAdapter({
        delegate: client[delegateKey] as PrismaDelegate,
        client: client as PrismaNativeClient,
        tableName,
        ...(options.idField !== undefined && { idField: options.idField }),
        ...(options.returnCreated !== undefined && { returnCreated: options.returnCreated }),
        model
      })

      const resource: ResourceDefinition = {
        name: model.name,
        routePrefix,
        tableName,
        fields: adapter.fields!,
        repository: adapter,
        permissions: { ...options.permissions, ...modelOpts.permissions }
      }
      if (adapter.relations?.length) resource.relations = adapter.relations
      if (modelOpts.requiredPermissions)
        resource.requiredPermissions = modelOpts.requiredPermissions
      const defaultLimit = modelOpts.defaultLimit ?? options.defaultLimit
      const maxLimit = modelOpts.maxLimit ?? options.maxLimit
      const maxFilterDepth = modelOpts.maxFilterDepth
      if (defaultLimit !== undefined) resource.defaultLimit = defaultLimit
      if (maxLimit !== undefined) resource.maxLimit = maxLimit
      if (maxFilterDepth !== undefined) resource.maxFilterDepth = maxFilterDepth
      return resource
    })
}
