import type {
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLFieldConfigMap,
  GraphQLInputFieldConfigMap
} from 'graphql'
import type { GraphQLResourceContext, GraphQLResolverContext } from './types.js'
import type { SchemaHelpers } from './schemaHelpers.js'
import {
  defaultCrudPermissions,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type ListOptions
} from '@/core/types.js'
import { toPascalCase } from '@/core/stringUtils.js'
import type { IQueryFilter, IQueryOptions, ISort } from '@edium/halifax-types'
import { SqlOrder } from '@edium/halifax-types'
import {
  applyHook,
  authorizeRequest,
  filterReadableFields,
  filterWritableFields,
  makeReadableFieldFilter,
  parseId
} from '@/core/handlerUtils.js'
import { validateAdvancedQuery, validateIncludes } from '@/core/validation.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'

type GqlModule = typeof import('graphql')

function applyPageLimits(
  resource: { defaultLimit?: number; maxLimit?: number },
  requestedLimit: number | undefined
): number | undefined {
  let limit = requestedLimit
  const cap = resource.maxLimit ?? MAX_PAGE_LIMIT
  if (limit === undefined) {
    const fallback = resource.defaultLimit ?? DEFAULT_PAGE_LIMIT
    if (fallback !== 0) limit = fallback
  }
  if (cap !== 0 && (limit === undefined || limit > cap)) limit = cap
  return limit
}

/**
 * Adds all query and mutation fields for a single resource to the provided field maps.
 * Called once per resource inside `buildGraphQLSchema`.
 */
export function addResourceFields(
  gql: GqlModule,
  helpers: SchemaHelpers,
  ctx: GraphQLResourceContext,
  queryFields: GraphQLFieldConfigMap<unknown, GraphQLResolverContext>,
  mutationFields: GraphQLFieldConfigMap<unknown, GraphQLResolverContext>
): void {
  const { resource, authStrategy, hooks, resolveRepo } = ctx
  if (resource.graphql === false) return

  const {
    GraphQLObjectType,
    GraphQLInputObjectType,
    GraphQLList,
    GraphQLNonNull,
    GraphQLString,
    GraphQLInt,
    GraphQLID,
    GraphQLBoolean
  } = gql

  const {
    OrderByInput,
    QueryFilterInput,
    fieldTypeToOutputGQL,
    fieldTypeToInputGQL,
    toGraphQLError
  } = helpers

  const permissions = { ...defaultCrudPermissions, ...resource.permissions }
  const idField = resource.repository?.idField ?? 'id'
  const typeName = toPascalCase(resource.routePrefix)
  const allFields = resource.fields ?? []
  const selectableFields = allFields.filter((f) => f.selectable !== false)
  const writableFields = allFields.filter((f) => f.name !== idField && f.writable !== false)
  const filterableFields = allFields.filter((f) => f.filterable !== false)

  // ─── Per-resource GraphQL types ─────────────────────────────────────────────

  const OutputType = new GraphQLObjectType({
    name: typeName,
    description: `A ${resource.name ?? typeName} record.`,
    fields: (): GraphQLFieldConfigMap<unknown, GraphQLResolverContext> => {
      const gqlFields: GraphQLFieldConfigMap<unknown, GraphQLResolverContext> = {}
      for (const f of selectableFields) {
        gqlFields[f.name] = { type: fieldTypeToOutputGQL(f.type, f.name === idField) }
      }
      return gqlFields
    }
  }) as GraphQLObjectType

  const ListResultType: GraphQLObjectType = new GraphQLObjectType({
    name: `${typeName}ListResult`,
    description: `Paginated list of ${typeName} records.`,
    fields: {
      count: { type: new GraphQLNonNull(GraphQLInt), description: 'Total matching records (before pagination).' },
      results: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(OutputType))), description: 'Records for the current page.' }
    }
  }) as GraphQLObjectType

  const makeWritableFields = (): GraphQLInputFieldConfigMap => {
    const gqlFields: GraphQLInputFieldConfigMap = {}
    for (const f of writableFields) {
      gqlFields[f.name] = { type: fieldTypeToInputGQL(f.type, false) }
    }
    return gqlFields
  }

  const CreateInputType = new GraphQLInputObjectType({
    name: `${typeName}CreateInput`,
    description: `Fields required to create a ${typeName}.`,
    fields: makeWritableFields
  }) as GraphQLInputObjectType

  const UpdateInputType = new GraphQLInputObjectType({
    name: `${typeName}UpdateInput`,
    description: `Fields to patch on a ${typeName}. All fields are optional.`,
    fields: makeWritableFields
  }) as GraphQLInputObjectType

  const FilterInputType = new GraphQLInputObjectType({
    name: `${typeName}FilterInput`,
    description: `Simple equality filter for listing ${typeName} records.`,
    fields: (): GraphQLInputFieldConfigMap => {
      const gqlFields: GraphQLInputFieldConfigMap = {}
      for (const f of filterableFields) {
        gqlFields[f.name] = { type: fieldTypeToInputGQL(f.type, f.name === idField) }
      }
      return gqlFields
    }
  }) as GraphQLInputObjectType

  const UpdateManyResultType: GraphQLObjectType = new GraphQLObjectType({
    name: `${typeName}UpdateManyResult`,
    fields: {
      updated: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLID))), description: 'IDs of updated records.' },
      results: { type: new GraphQLList(OutputType), description: 'Updated records (when the repository supports returning them).' }
    }
  }) as GraphQLObjectType

  const DeleteManyResultType: GraphQLObjectType = new GraphQLObjectType({
    name: `${typeName}DeleteManyResult`,
    fields: {
      deleted: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLID))), description: 'IDs of deleted records.' }
    }
  }) as GraphQLObjectType

  // ─── Query: get (readOne) ──────────────────────────────────────────────────

  if (permissions.allowReadOne) {
    queryFields[`get${typeName}`] = {
      type: OutputType,
      description: `Fetch a single ${typeName} by ID.`,
      args: { id: { type: new GraphQLNonNull(GraphQLID), description: 'Record ID.' } },
      async resolve(_parent, args: { id: string }, context: GraphQLResolverContext): Promise<unknown> {
        try {
          const auth = await authorizeRequest(context.req, resource, 'readOne', authStrategy)
          const repo = await resolveRepo(context.req, auth, 'readOne')
          const id = parseId(args.id)
          const hookCtx = { auth, resource, req: context.req }
          if (hooks?.beforeReadOne) await hooks.beforeReadOne(id, hookCtx)
          const rawResult = await repo.getOne(id)
          if (!rawResult) throw new NotFoundError()
          const result = await applyHook(hooks?.afterReadOne, rawResult as Record<string, unknown>, hookCtx)
          return filterReadableFields(resource, result, auth)
        } catch (e) { toGraphQLError(e) }
      }
    }
  }

  // ─── Query: list (readMany) ────────────────────────────────────────────────

  if (permissions.allowReadMany) {
    queryFields[`list${typeName}`] = {
      type: new GraphQLNonNull(ListResultType),
      description: `Fetch a paginated list of ${typeName} records. For advanced filtering use \`query${typeName}\`.`,
      args: {
        filter: { type: FilterInputType, description: 'Per-field equality filters.' },
        limit: { type: GraphQLInt, description: 'Maximum records to return.' },
        offset: { type: GraphQLInt, description: 'Records to skip.' },
        orderBy: { type: new GraphQLList(new GraphQLNonNull(OrderByInput)), description: 'Sort order.' },
        include: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)), description: 'Relation names to eagerly load.' }
      },
      async resolve(
        _parent,
        args: { filter?: Record<string, unknown>; limit?: number; offset?: number; orderBy?: Array<{ field: string; direction: string }>; include?: string[] },
        context: GraphQLResolverContext
      ): Promise<unknown> {
        try {
          const auth = await authorizeRequest(context.req, resource, 'readMany', authStrategy)
          const repo = await resolveRepo(context.req, auth, 'readMany')
          const hookCtx = { auth, resource, req: context.req }
          if (args.include?.length) validateIncludes(resource, args.include)
          const where: Record<string, unknown> = {}
          if (args.filter) {
            for (const [key, val] of Object.entries(args.filter)) {
              if (val !== undefined && val !== null) where[key] = val
            }
          }
          const listOptions: ListOptions = {
            where,
            limit: applyPageLimits(resource, args.limit),
            offset: args.offset,
            orderBy: args.orderBy?.map((o) => ({ field: o.field, direction: o.direction as 'asc' | 'desc' })),
            include: args.include
          }
          const processedOptions = await applyHook(hooks?.beforeReadMany, listOptions, hookCtx)
          const rawResult = await repo.getMany(processedOptions)
          const result = await applyHook(hooks?.afterReadMany, rawResult as { count: number; results: Record<string, unknown>[] }, hookCtx)
          const filterRecord = makeReadableFieldFilter(resource, auth)
          return { count: result.count, results: result.results.map(filterRecord) }
        } catch (e) { toGraphQLError(e) }
      }
    }
  }

  // ─── Query: query (readManyWithQueryBuilder) ───────────────────────────────

  if (permissions.allowReadManyWithQueryBuilder) {
    queryFields[`query${typeName}`] = {
      type: new GraphQLNonNull(ListResultType),
      description: `Advanced query for ${typeName} with full filter expressions, sorting, and pagination. Mirrors the REST \`POST /${resource.routePrefix}/query\` endpoint.`,
      args: {
        where: { type: new GraphQLList(new GraphQLNonNull(QueryFilterInput)), description: 'Filter conditions. Supports all operators (=, IN, LIKE, BETWEEN, …).' },
        fields: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)), description: 'Field names to include. Omit for all selectable fields.' },
        distinct: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)), description: 'Fields to de-duplicate on (SQL DISTINCT ON).' },
        limit: { type: GraphQLInt, description: 'Maximum records to return.' },
        offset: { type: GraphQLInt, description: 'Records to skip.' },
        orderBy: { type: new GraphQLList(new GraphQLNonNull(OrderByInput)), description: 'Sort order.' },
        include: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)), description: 'Relation names to eagerly load.' }
      },
      async resolve(
        _parent,
        args: { where?: Record<string, unknown>[]; fields?: string[]; distinct?: string[]; limit?: number; offset?: number; orderBy?: Array<{ field: string; direction: string }>; include?: string[] },
        context: GraphQLResolverContext
      ): Promise<unknown> {
        try {
          const auth = await authorizeRequest(context.req, resource, 'readManyWithQueryBuilder', authStrategy)
          const repo = await resolveRepo(context.req, auth, 'readManyWithQueryBuilder')
          if (!repo.executeQuery) throw new NotImplementedError('This resource does not support the query builder.')
          const hookCtx = { auth, resource, req: context.req }
          const queryOrderBy: ISort[] | undefined = args.orderBy?.map((o) => ({
            field: o.field,
            order: (o.direction.toUpperCase() === 'DESC' ? SqlOrder.DESC : SqlOrder.ASC)
          }))
          const query: IQueryOptions = {
            ...(args.where !== undefined ? { where: args.where as unknown as IQueryFilter[] } : {}),
            ...(args.fields !== undefined ? { fields: args.fields } : {}),
            ...(args.distinct !== undefined ? { distinct: args.distinct } : {}),
            ...(args.limit !== undefined ? { limit: args.limit } : {}),
            ...(args.offset !== undefined ? { offset: args.offset } : {}),
            ...(queryOrderBy !== undefined ? { orderBy: queryOrderBy } : {}),
            ...(args.include !== undefined ? { include: args.include } : {})
          }
          const processedQuery = await applyHook(hooks?.beforeQuery, query, hookCtx)
          validateAdvancedQuery(resource, processedQuery)
          const rawResult = await repo.executeQuery(processedQuery)
          const result = await applyHook(hooks?.afterQuery, rawResult as { count?: number; results: Record<string, unknown>[] }, hookCtx)
          const filterRecord = makeReadableFieldFilter(resource, auth)
          return { count: result.count ?? result.results.length, results: result.results.map(filterRecord) }
        } catch (e) { toGraphQLError(e) }
      }
    }
  }

  // ─── Mutation: create ─────────────────────────────────────────────────────

  if (permissions.allowCreate) {
    mutationFields[`create${typeName}`] = {
      type: new GraphQLNonNull(OutputType),
      description: `Create a single ${typeName} record.`,
      args: { input: { type: new GraphQLNonNull(CreateInputType) } },
      async resolve(_parent, args: { input: Record<string, unknown> }, context: GraphQLResolverContext): Promise<unknown> {
        try {
          const auth = await authorizeRequest(context.req, resource, 'create', authStrategy)
          const repo = await resolveRepo(context.req, auth, 'create')
          const hookCtx = { auth, resource, req: context.req }
          const filtered = filterWritableFields(resource, args.input, auth)
          const data = await applyHook(hooks?.beforeCreate, filtered, hookCtx)
          const rawResult = await repo.createOne(data as never)
          const result = await applyHook(hooks?.afterCreate, rawResult as Record<string, unknown>, hookCtx)
          return filterReadableFields(resource, result, auth)
        } catch (e) { toGraphQLError(e) }
      }
    }

    mutationFields[`createMany${typeName}`] = {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(OutputType))),
      description: `Create multiple ${typeName} records.`,
      args: { input: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(CreateInputType))) } },
      async resolve(_parent, args: { input: Record<string, unknown>[] }, context: GraphQLResolverContext): Promise<unknown> {
        try {
          const auth = await authorizeRequest(context.req, resource, 'create', authStrategy)
          const repo = await resolveRepo(context.req, auth, 'create')
          const hookCtx = { auth, resource, req: context.req }
          const rawItems = args.input.map((item) => filterWritableFields(resource, item, auth))
          const items = hooks?.beforeCreate
            ? await Promise.all(rawItems.map((d) => applyHook(hooks.beforeCreate, d, hookCtx)))
            : rawItems
          const rawResults = await repo.createMany(items as never[])
          const results = hooks?.afterCreate
            ? await Promise.all(rawResults.map((r) => applyHook(hooks.afterCreate, r as Record<string, unknown>, hookCtx)))
            : (rawResults as Record<string, unknown>[])
          const filterRecord = makeReadableFieldFilter(resource, auth)
          return results.map(filterRecord)
        } catch (e) { toGraphQLError(e) }
      }
    }
  }

  // ─── Mutation: update ─────────────────────────────────────────────────────

  if (permissions.allowUpdateOne) {
    mutationFields[`update${typeName}`] = {
      type: OutputType,
      description: `Partially update a single ${typeName} by ID.`,
      args: { id: { type: new GraphQLNonNull(GraphQLID) }, input: { type: new GraphQLNonNull(UpdateInputType) } },
      async resolve(_parent, args: { id: string; input: Record<string, unknown> }, context: GraphQLResolverContext): Promise<unknown> {
        try {
          const auth = await authorizeRequest(context.req, resource, 'updateOne', authStrategy)
          const repo = await resolveRepo(context.req, auth, 'updateOne')
          const id = parseId(args.id)
          const hookCtx = { auth, resource, req: context.req }
          const rawBody = filterWritableFields(resource, args.input, auth)
          const body = hooks?.beforeUpdateOne ? ((await hooks.beforeUpdateOne(id, rawBody, hookCtx)) ?? rawBody) : rawBody
          const rawResult = await repo.updateOne(id, body as never)
          if (!rawResult) throw new NotFoundError()
          const result = await applyHook(hooks?.afterUpdateOne, rawResult as Record<string, unknown>, hookCtx)
          return filterReadableFields(resource, result, auth)
        } catch (e) { toGraphQLError(e) }
      }
    }
  }

  // ─── Mutation: updateMany ─────────────────────────────────────────────────

  if (permissions.allowUpdateMany) {
    mutationFields[`updateMany${typeName}`] = {
      type: new GraphQLNonNull(UpdateManyResultType),
      description: `Bulk-update ${typeName} records matching the given filter.`,
      args: {
        where: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(QueryFilterInput))), description: 'At least one filter is required to prevent accidental full-table updates.' },
        update: { type: new GraphQLNonNull(UpdateInputType), description: 'Fields to apply to every matched record.' }
      },
      async resolve(_parent, args: { where: Record<string, unknown>[]; update: Record<string, unknown> }, context: GraphQLResolverContext): Promise<unknown> {
        try {
          const auth = await authorizeRequest(context.req, resource, 'updateMany', authStrategy)
          const repo = await resolveRepo(context.req, auth, 'updateMany')
          if (!repo.updateMany) throw new NotImplementedError('This resource does not support updateMany.')
          const hookCtx = { auth, resource, req: context.req }
          const filteredUpdate = filterWritableFields(resource, args.update, auth)
          if (!Object.keys(filteredUpdate).length) throw new UnprocessableEntityError('updateMany requires at least one writable field in the update payload.')
          const query: IQueryOptions = { where: args.where as unknown as IQueryFilter[] }
          validateAdvancedQuery(resource, query)
          if (!query.where?.length) throw new UnprocessableEntityError('updateMany requires at least one WHERE filter to prevent unintended bulk updates.')
          if (hooks?.beforeUpdateMany) await hooks.beforeUpdateMany(query, filteredUpdate, hookCtx)
          const rawResult = await repo.updateMany(query, filteredUpdate as never)
          const result = await applyHook(hooks?.afterUpdateMany, rawResult as { updated: unknown[]; results?: Record<string, unknown>[] }, hookCtx)
          const filterRecord = makeReadableFieldFilter(resource, auth)
          return {
            updated: result.updated,
            ...(result.results ? { results: result.results.map((r) => filterRecord(r as Record<string, unknown>)) } : {})
          }
        } catch (e) { toGraphQLError(e) }
      }
    }
  }

  // ─── Mutation: upsert ─────────────────────────────────────────────────────

  if (permissions.allowUpsertOne) {
    mutationFields[`upsert${typeName}`] = {
      type: new GraphQLNonNull(OutputType),
      description: `Create or replace a ${typeName} at the given ID.`,
      args: { id: { type: new GraphQLNonNull(GraphQLID) }, input: { type: new GraphQLNonNull(CreateInputType) } },
      async resolve(_parent, args: { id: string; input: Record<string, unknown> }, context: GraphQLResolverContext): Promise<unknown> {
        try {
          const auth = await authorizeRequest(context.req, resource, 'upsertOne', authStrategy)
          const repo = await resolveRepo(context.req, auth, 'upsertOne')
          if (!repo.upsertOne) throw new NotImplementedError('This resource does not support upsert.')
          const id = parseId(args.id)
          const hookCtx = { auth, resource, req: context.req }
          const rawBody = filterWritableFields(resource, args.input, auth)
          const body = hooks?.beforeUpsertOne ? ((await hooks.beforeUpsertOne(id, rawBody, hookCtx)) ?? rawBody) : rawBody
          const rawResult = await repo.upsertOne(id, body as never)
          const result = await applyHook(hooks?.afterUpsertOne, rawResult as Record<string, unknown>, hookCtx)
          return filterReadableFields(resource, result, auth)
        } catch (e) { toGraphQLError(e) }
      }
    }
  }

  // ─── Mutation: deleteOne ──────────────────────────────────────────────────

  if (permissions.allowDeleteOne) {
    mutationFields[`delete${typeName}`] = {
      type: new GraphQLNonNull(GraphQLBoolean),
      description: `Delete a single ${typeName} by ID. Returns true when deleted.`,
      args: { id: { type: new GraphQLNonNull(GraphQLID) } },
      async resolve(_parent, args: { id: string }, context: GraphQLResolverContext): Promise<unknown> {
        try {
          const auth = await authorizeRequest(context.req, resource, 'deleteOne', authStrategy)
          const repo = await resolveRepo(context.req, auth, 'deleteOne')
          const id = parseId(args.id)
          const hookCtx = { auth, resource, req: context.req }
          if (hooks?.beforeDeleteOne) await hooks.beforeDeleteOne(id, hookCtx)
          const deleted = await repo.deleteOne(id)
          if (!deleted) throw new NotFoundError()
          if (hooks?.afterDeleteOne) await hooks.afterDeleteOne(id, hookCtx)
          return true
        } catch (e) { toGraphQLError(e) }
      }
    }
  }

  // ─── Mutation: deleteMany ─────────────────────────────────────────────────

  if (permissions.allowDeleteMany) {
    mutationFields[`deleteMany${typeName}`] = {
      type: new GraphQLNonNull(DeleteManyResultType),
      description: `Bulk-delete ${typeName} records matching the given filter.`,
      args: {
        where: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(QueryFilterInput))), description: 'At least one filter is required to prevent accidental full-table deletes.' }
      },
      async resolve(_parent, args: { where: Record<string, unknown>[] }, context: GraphQLResolverContext): Promise<unknown> {
        try {
          const auth = await authorizeRequest(context.req, resource, 'deleteMany', authStrategy)
          const repo = await resolveRepo(context.req, auth, 'deleteMany')
          if (!repo.deleteMany) throw new NotImplementedError('This resource does not support deleteMany.')
          const hookCtx = { auth, resource, req: context.req }
          const query: IQueryOptions = { where: args.where as unknown as IQueryFilter[] }
          validateAdvancedQuery(resource, query)
          if (!query.where?.length) throw new UnprocessableEntityError('deleteMany requires at least one WHERE filter to prevent unintended bulk deletes.')
          if (hooks?.beforeDeleteMany) await hooks.beforeDeleteMany(query, hookCtx)
          const rawResult = await repo.deleteMany(query)
          const result = await applyHook(hooks?.afterDeleteMany, rawResult, hookCtx)
          return { deleted: result.deleted }
        } catch (e) { toGraphQLError(e) }
      }
    }
  }
}
