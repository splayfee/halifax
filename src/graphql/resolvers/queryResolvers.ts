import type { GraphQLFieldConfigMap } from 'graphql'
import type { GraphQLResolverContext } from '../types.js'
import type { ResolverContext } from './resourceTypes.js'
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type CrudPermissions,
  type ListOptions
} from '@/core/types.js'
import type { IQueryFilter, IQueryOptions, ISort } from '@edium/halifax-types'
import { SqlOrder } from '@edium/halifax-types'
import { authorizeRequest } from '@/core/authUtils.js'
import { filterReadableFields, makeReadableFieldFilter } from '@/core/fieldUtils.js'
import { applyHook, parseId } from '@/core/handlerUtils.js'
import { validateAdvancedQuery, validateIncludes } from '@/core/validation.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'

type QueryFields = GraphQLFieldConfigMap<unknown, GraphQLResolverContext>

/** Clamps a requested page limit to the resource's `defaultLimit`/`maxLimit` (0 = unbounded). */
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

/** Registers the `get<Type>` resolver (readOne). */
function addGet(rc: ResolverContext, queryFields: QueryFields): void {
  const { resource, authStrategy, hooks, resolveRepo, typeName, types, gql, helpers } = rc
  const { GraphQLNonNull, GraphQLID } = gql
  queryFields[`get${typeName}`] = {
    type: types.OutputType,
    description: `Fetch a single ${typeName} by ID.`,
    args: { id: { type: new GraphQLNonNull(GraphQLID), description: 'Record ID.' } },
    async resolve(
      _parent,
      args: { id: string },
      context: GraphQLResolverContext
    ): Promise<unknown> {
      try {
        const auth = await authorizeRequest(context.req, resource, 'readOne', authStrategy)
        const repo = await resolveRepo(context.req, auth, 'readOne')
        const id = parseId(args.id)
        const hookCtx = { auth, resource, req: context.req }
        if (hooks?.beforeReadOne) await hooks.beforeReadOne(id, hookCtx)
        const rawResult = await repo.getOne(id)
        if (!rawResult) throw new NotFoundError()
        const result = await applyHook(
          hooks?.afterReadOne,
          rawResult as Record<string, unknown>,
          hookCtx
        )
        return filterReadableFields(resource, result, auth)
      } catch (e) {
        helpers.toGraphQLError(e)
      }
    }
  }
}

/** Registers the `list<Type>` resolver (readMany with simple equality filters). */
function addList(rc: ResolverContext, queryFields: QueryFields): void {
  const { resource, authStrategy, hooks, resolveRepo, typeName, types, gql, helpers } = rc
  const { GraphQLNonNull, GraphQLList, GraphQLString, GraphQLInt } = gql
  queryFields[`list${typeName}`] = {
    type: new GraphQLNonNull(types.ListResultType),
    description: `Fetch a paginated list of ${typeName} records. For advanced filtering use \`query${typeName}\`.`,
    args: {
      filter: { type: types.FilterInputType, description: 'Per-field equality filters.' },
      limit: { type: GraphQLInt, description: 'Maximum records to return.' },
      offset: { type: GraphQLInt, description: 'Records to skip.' },
      orderBy: {
        type: new GraphQLList(new GraphQLNonNull(helpers.OrderByInput)),
        description: 'Sort order.'
      },
      include: {
        type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
        description: 'Relation names to eagerly load.'
      }
    },
    async resolve(
      _parent,
      args: {
        filter?: Record<string, unknown>
        limit?: number
        offset?: number
        orderBy?: Array<{ field: string; direction: string }>
        include?: string[]
      },
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
          orderBy: args.orderBy?.map((o) => ({
            field: o.field,
            direction: o.direction as 'asc' | 'desc'
          })),
          include: args.include
        }
        const processedOptions = await applyHook(hooks?.beforeReadMany, listOptions, hookCtx)
        const rawResult = await repo.getMany(processedOptions)
        const result = await applyHook(
          hooks?.afterReadMany,
          rawResult as { count: number; results: Record<string, unknown>[] },
          hookCtx
        )
        const filterRecord = makeReadableFieldFilter(resource, auth)
        return { count: result.count, results: result.results.map(filterRecord) }
      } catch (e) {
        helpers.toGraphQLError(e)
      }
    }
  }
}

/** Registers the `query<Type>` resolver (readManyWithQueryBuilder — advanced filter expressions). */
function addQuery(rc: ResolverContext, queryFields: QueryFields): void {
  const { resource, authStrategy, hooks, resolveRepo, typeName, types, gql, helpers } = rc
  const { GraphQLNonNull, GraphQLList, GraphQLString, GraphQLInt } = gql
  queryFields[`query${typeName}`] = {
    type: new GraphQLNonNull(types.ListResultType),
    description: `Advanced query for ${typeName} with full filter expressions, sorting, and pagination. Mirrors the REST \`POST /${resource.routePrefix}/query\` endpoint.`,
    args: {
      where: {
        type: new GraphQLList(new GraphQLNonNull(helpers.QueryFilterInput)),
        description: 'Filter conditions. Supports all operators (=, IN, LIKE, BETWEEN, …).'
      },
      fields: {
        type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
        description: 'Field names to include. Omit for all selectable fields.'
      },
      distinct: {
        type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
        description: 'Fields to de-duplicate on (SQL DISTINCT ON).'
      },
      limit: { type: GraphQLInt, description: 'Maximum records to return.' },
      offset: { type: GraphQLInt, description: 'Records to skip.' },
      orderBy: {
        type: new GraphQLList(new GraphQLNonNull(helpers.OrderByInput)),
        description: 'Sort order.'
      },
      include: {
        type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
        description: 'Relation names to eagerly load.'
      }
    },
    async resolve(
      _parent,
      args: {
        where?: Record<string, unknown>[]
        fields?: string[]
        distinct?: string[]
        limit?: number
        offset?: number
        orderBy?: Array<{ field: string; direction: string }>
        include?: string[]
      },
      context: GraphQLResolverContext
    ): Promise<unknown> {
      try {
        const auth = await authorizeRequest(
          context.req,
          resource,
          'readManyWithQueryBuilder',
          authStrategy
        )
        const repo = await resolveRepo(context.req, auth, 'readManyWithQueryBuilder')
        if (!repo.executeQuery)
          throw new NotImplementedError('This resource does not support the query builder.')
        const hookCtx = { auth, resource, req: context.req }
        const queryOrderBy: ISort[] | undefined = args.orderBy?.map((o) => ({
          field: o.field,
          order: o.direction.toUpperCase() === 'DESC' ? SqlOrder.DESC : SqlOrder.ASC
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
        const result = await applyHook(
          hooks?.afterQuery,
          rawResult as { count?: number; results: Record<string, unknown>[] },
          hookCtx
        )
        const filterRecord = makeReadableFieldFilter(resource, auth)
        return {
          count: result.count ?? result.results.length,
          results: result.results.map(filterRecord)
        }
      } catch (e) {
        helpers.toGraphQLError(e)
      }
    }
  }
}

/** Adds all enabled read resolvers (`get`, `list`, `query`) for a resource to the query field map. */
export function addQueryResolvers(
  rc: ResolverContext,
  permissions: Required<CrudPermissions>,
  queryFields: QueryFields
): void {
  if (permissions.allowReadOne) addGet(rc, queryFields)
  if (permissions.allowReadMany) addList(rc, queryFields)
  if (permissions.allowReadManyWithQueryBuilder) addQuery(rc, queryFields)
}
