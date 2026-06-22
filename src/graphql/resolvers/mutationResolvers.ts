import type { GraphQLFieldConfigMap } from 'graphql'
import type { GraphQLResolverContext } from '../types.js'
import type { ResolverContext } from './resourceTypes.js'
import { type CrudPermissions } from '@/core/types.js'
import type { IQueryFilter, IQueryOptions } from '@edium/halifax-types'
import { authorizeRequest } from '@/core/authUtils.js'
import {
  filterReadableFields,
  filterWritableFields,
  makeReadableFieldFilter
} from '@/core/fieldUtils.js'
import { applyHook, parseId } from '@/core/handlerUtils.js'
import { validateAdvancedQuery } from '@/core/validation.js'
import { NotFoundError } from '@/errors/NotFoundError.js'
import { NotImplementedError } from '@/errors/NotImplementedError.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'

type MutationFields = GraphQLFieldConfigMap<unknown, GraphQLResolverContext>

/** Registers `create<Type>` and `createMany<Type>` resolvers. */
function addCreate(rc: ResolverContext, mutationFields: MutationFields): void {
  const { resource, authStrategy, hooks, resolveRepo, typeName, types, gql, helpers } = rc
  const { GraphQLNonNull, GraphQLList } = gql

  mutationFields[`create${typeName}`] = {
    type: new GraphQLNonNull(types.OutputType),
    description: `Create a single ${typeName} record.`,
    args: { input: { type: new GraphQLNonNull(types.CreateInputType) } },
    async resolve(
      _parent,
      args: { input: Record<string, unknown> },
      context: GraphQLResolverContext
    ): Promise<unknown> {
      try {
        const auth = await authorizeRequest(context.req, resource, 'create', authStrategy)
        const repo = await resolveRepo(context.req, auth, 'create')
        const hookCtx = { auth, resource, req: context.req }
        const filtered = filterWritableFields(resource, args.input, auth)
        const data = await applyHook(hooks?.beforeCreate, filtered, hookCtx)
        const rawResult = await repo.createOne(data)
        const result = await applyHook(
          hooks?.afterCreate,
          rawResult as Record<string, unknown>,
          hookCtx
        )
        return filterReadableFields(resource, result, auth)
      } catch (e) {
        helpers.toGraphQLError(e)
      }
    }
  }

  mutationFields[`createMany${typeName}`] = {
    type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(types.OutputType))),
    description: `Create multiple ${typeName} records.`,
    args: {
      input: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(types.CreateInputType)))
      }
    },
    async resolve(
      _parent,
      args: { input: Record<string, unknown>[] },
      context: GraphQLResolverContext
    ): Promise<unknown> {
      try {
        const auth = await authorizeRequest(context.req, resource, 'create', authStrategy)
        const repo = await resolveRepo(context.req, auth, 'create')
        const hookCtx = { auth, resource, req: context.req }
        const rawItems = args.input.map((item) => filterWritableFields(resource, item, auth))
        const items = hooks?.beforeCreate
          ? await Promise.all(rawItems.map((d) => applyHook(hooks.beforeCreate, d, hookCtx)))
          : rawItems
        const rawResults = await repo.createMany(items)
        const results = hooks?.afterCreate
          ? await Promise.all(
              rawResults.map((r) =>
                applyHook(hooks.afterCreate, r as Record<string, unknown>, hookCtx)
              )
            )
          : (rawResults as Record<string, unknown>[])
        const filterRecord = makeReadableFieldFilter(resource, auth)
        return results.map(filterRecord)
      } catch (e) {
        helpers.toGraphQLError(e)
      }
    }
  }
}

/** Registers the `update<Type>` resolver (updateOne). */
function addUpdateOne(rc: ResolverContext, mutationFields: MutationFields): void {
  const { resource, authStrategy, hooks, resolveRepo, typeName, types, gql, helpers } = rc
  const { GraphQLNonNull, GraphQLID } = gql
  mutationFields[`update${typeName}`] = {
    type: types.OutputType,
    description: `Partially update a single ${typeName} by ID.`,
    args: {
      id: { type: new GraphQLNonNull(GraphQLID) },
      input: { type: new GraphQLNonNull(types.UpdateInputType) }
    },
    async resolve(
      _parent,
      args: { id: string; input: Record<string, unknown> },
      context: GraphQLResolverContext
    ): Promise<unknown> {
      try {
        const auth = await authorizeRequest(context.req, resource, 'updateOne', authStrategy)
        const repo = await resolveRepo(context.req, auth, 'updateOne')
        const id = parseId(args.id)
        const hookCtx = { auth, resource, req: context.req }
        const rawBody = filterWritableFields(resource, args.input, auth)
        const body = hooks?.beforeUpdateOne
          ? ((await hooks.beforeUpdateOne(id, rawBody, hookCtx)) ?? rawBody)
          : rawBody
        const rawResult = await repo.updateOne(id, body)
        if (!rawResult) throw new NotFoundError()
        const result = await applyHook(
          hooks?.afterUpdateOne,
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

/** Registers the `updateMany<Type>` resolver (bulk update, requires a WHERE filter). */
function addUpdateMany(rc: ResolverContext, mutationFields: MutationFields): void {
  const { resource, authStrategy, hooks, resolveRepo, typeName, types, gql, helpers } = rc
  const { GraphQLNonNull, GraphQLList } = gql
  mutationFields[`updateMany${typeName}`] = {
    type: new GraphQLNonNull(types.UpdateManyResultType),
    description: `Bulk-update ${typeName} records matching the given filter.`,
    args: {
      where: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(helpers.QueryFilterInput))),
        description: 'At least one filter is required to prevent accidental full-table updates.'
      },
      update: {
        type: new GraphQLNonNull(types.UpdateInputType),
        description: 'Fields to apply to every matched record.'
      }
    },
    async resolve(
      _parent,
      args: { where: Record<string, unknown>[]; update: Record<string, unknown> },
      context: GraphQLResolverContext
    ): Promise<unknown> {
      try {
        const auth = await authorizeRequest(context.req, resource, 'updateMany', authStrategy)
        const repo = await resolveRepo(context.req, auth, 'updateMany')
        if (!repo.updateMany)
          throw new NotImplementedError('This resource does not support updateMany.')
        const hookCtx = { auth, resource, req: context.req }
        const filteredUpdate = filterWritableFields(resource, args.update, auth)
        if (!Object.keys(filteredUpdate).length)
          throw new UnprocessableEntityError(
            'updateMany requires at least one writable field in the update payload.'
          )
        const query: IQueryOptions = { where: args.where as unknown as IQueryFilter[] }
        validateAdvancedQuery(resource, query)
        if (!query.where?.length)
          throw new UnprocessableEntityError(
            'updateMany requires at least one WHERE filter to prevent unintended bulk updates.'
          )
        if (hooks?.beforeUpdateMany) await hooks.beforeUpdateMany(query, filteredUpdate, hookCtx)
        const rawResult = await repo.updateMany(query, filteredUpdate)
        const result = await applyHook(
          hooks?.afterUpdateMany,
          rawResult as { updated: unknown[]; results?: Record<string, unknown>[] },
          hookCtx
        )
        const filterRecord = makeReadableFieldFilter(resource, auth)
        return {
          updated: result.updated,
          ...(result.results
            ? { results: result.results.map((r) => filterRecord(r as Record<string, unknown>)) }
            : {})
        }
      } catch (e) {
        helpers.toGraphQLError(e)
      }
    }
  }
}

/** Registers the `upsert<Type>` resolver. */
function addUpsert(rc: ResolverContext, mutationFields: MutationFields): void {
  const { resource, authStrategy, hooks, resolveRepo, typeName, types, gql, helpers } = rc
  const { GraphQLNonNull, GraphQLID } = gql
  mutationFields[`upsert${typeName}`] = {
    type: new GraphQLNonNull(types.OutputType),
    description: `Create or replace a ${typeName} at the given ID.`,
    args: {
      id: { type: new GraphQLNonNull(GraphQLID) },
      input: { type: new GraphQLNonNull(types.CreateInputType) }
    },
    async resolve(
      _parent,
      args: { id: string; input: Record<string, unknown> },
      context: GraphQLResolverContext
    ): Promise<unknown> {
      try {
        const auth = await authorizeRequest(context.req, resource, 'upsertOne', authStrategy)
        const repo = await resolveRepo(context.req, auth, 'upsertOne')
        if (!repo.upsertOne) throw new NotImplementedError('This resource does not support upsert.')
        const id = parseId(args.id)
        const hookCtx = { auth, resource, req: context.req }
        const rawBody = filterWritableFields(resource, args.input, auth)
        const body = hooks?.beforeUpsertOne
          ? ((await hooks.beforeUpsertOne(id, rawBody, hookCtx)) ?? rawBody)
          : rawBody
        const rawResult = await repo.upsertOne(id, body)
        const result = await applyHook(
          hooks?.afterUpsertOne,
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

/** Registers the `delete<Type>` resolver (deleteOne). */
function addDeleteOne(rc: ResolverContext, mutationFields: MutationFields): void {
  const { resource, authStrategy, hooks, resolveRepo, typeName, gql, helpers } = rc
  const { GraphQLNonNull, GraphQLID, GraphQLBoolean } = gql
  mutationFields[`delete${typeName}`] = {
    type: new GraphQLNonNull(GraphQLBoolean),
    description: `Delete a single ${typeName} by ID. Returns true when deleted.`,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(
      _parent,
      args: { id: string },
      context: GraphQLResolverContext
    ): Promise<unknown> {
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
      } catch (e) {
        helpers.toGraphQLError(e)
      }
    }
  }
}

/** Registers the `deleteMany<Type>` resolver (bulk delete, requires a WHERE filter). */
function addDeleteMany(rc: ResolverContext, mutationFields: MutationFields): void {
  const { resource, authStrategy, hooks, resolveRepo, typeName, types, gql, helpers } = rc
  const { GraphQLNonNull, GraphQLList } = gql
  mutationFields[`deleteMany${typeName}`] = {
    type: new GraphQLNonNull(types.DeleteManyResultType),
    description: `Bulk-delete ${typeName} records matching the given filter.`,
    args: {
      where: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(helpers.QueryFilterInput))),
        description: 'At least one filter is required to prevent accidental full-table deletes.'
      }
    },
    async resolve(
      _parent,
      args: { where: Record<string, unknown>[] },
      context: GraphQLResolverContext
    ): Promise<unknown> {
      try {
        const auth = await authorizeRequest(context.req, resource, 'deleteMany', authStrategy)
        const repo = await resolveRepo(context.req, auth, 'deleteMany')
        if (!repo.deleteMany)
          throw new NotImplementedError('This resource does not support deleteMany.')
        const hookCtx = { auth, resource, req: context.req }
        const query: IQueryOptions = { where: args.where as unknown as IQueryFilter[] }
        validateAdvancedQuery(resource, query)
        if (!query.where?.length)
          throw new UnprocessableEntityError(
            'deleteMany requires at least one WHERE filter to prevent unintended bulk deletes.'
          )
        if (hooks?.beforeDeleteMany) await hooks.beforeDeleteMany(query, hookCtx)
        const rawResult = await repo.deleteMany(query)
        const result = await applyHook(hooks?.afterDeleteMany, rawResult, hookCtx)
        return { deleted: result.deleted }
      } catch (e) {
        helpers.toGraphQLError(e)
      }
    }
  }
}

/** Adds all enabled write resolvers (create/update/upsert/delete + bulk variants) for a resource. */
export function addMutationResolvers(
  rc: ResolverContext,
  permissions: Required<CrudPermissions>,
  mutationFields: MutationFields
): void {
  if (permissions.allowCreate) addCreate(rc, mutationFields)
  if (permissions.allowUpdateOne) addUpdateOne(rc, mutationFields)
  if (permissions.allowUpdateMany) addUpdateMany(rc, mutationFields)
  if (permissions.allowUpsertOne) addUpsert(rc, mutationFields)
  if (permissions.allowDeleteOne) addDeleteOne(rc, mutationFields)
  if (permissions.allowDeleteMany) addDeleteMany(rc, mutationFields)
}
