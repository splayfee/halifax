import type { ModelField, ResourceDefinition } from '@/core/types.js'
import type { CreatePrismaResourcesOptions, PrismaDelegate, PrismaNativeClient } from './types.js'
import { PrismaAdapter } from './PrismaAdapter.js'
import { toRoutePrefix } from './helpers.js'

/**
 * Creates resource definitions for Prisma models based on the provided schema and options.
 * @param prismaClient An instance of the Prisma client to be used for database operations.
 * @param schema  An array of model definitions, where each model includes its name, optional database name, and fields.
 * @param options An optional configuration object that allows customization of the generated resources, including model-specific options, default limits, and permissions.
 * @returns An array of resource definitions that can be used to set up API endpoints or other data access layers based on the Prisma models.
 */
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

      // Tenant scoping: an explicit per-model setting wins (including `false` to opt out);
      // otherwise auto-detect by the global tenant field when the model actually has it.
      if (modelOpts.tenant !== undefined) {
        resource.tenant = modelOpts.tenant
      } else if (
        options.tenantField &&
        adapter.fields!.some((f) => f.name === options.tenantField)
      ) {
        resource.tenant = { field: options.tenantField }
      }

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
