import type { CrudHooks } from '@/core/hooks.js'
import type { FieldDefinition, TenantResourceConfig, RelationDefinition } from './field.js'
import type { Repository } from './repository.js'

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/** All CRUD action identifiers used for permissions and audit. */
export type CrudAction =
  | 'create'
  | 'readOne'
  | 'readMany'
  | 'readManyWithQueryBuilder'
  | 'updateOne'
  | 'updateMany'
  | 'upsertOne'
  | 'deleteOne'
  | 'deleteMany'

/** Per-action toggles controlling which CRUD endpoints are registered for a resource. */
export interface CrudPermissions {
  allowCreate?: boolean
  allowReadOne?: boolean
  allowReadMany?: boolean
  allowReadManyWithQueryBuilder?: boolean
  allowUpdateOne?: boolean
  allowUpdateMany?: boolean
  allowUpsertOne?: boolean
  allowDeleteOne?: boolean
  allowDeleteMany?: boolean
}

// ─── Resource ─────────────────────────────────────────────────────────────────

/** Per-resource read-through cache configuration. */
export interface ResourceCacheConfig {
  /** Time-to-live for cached reads, in seconds. `0` means **never expire** (cache forever). */
  ttlSeconds: number
}

/** Full definition of a Halifax resource: its repository, field schema, routing, and permissions. */
export interface ResourceDefinition<
  TRecord = unknown,
  TCreate = Partial<TRecord>,
  TUpdate = Partial<TRecord>
> {
  /**
   * URL path segment (e.g. `'users'`, `'blog-posts'`). The only required field — it defines
   * the resource's public route, which has no safe default.
   */
  routePrefix: string
  /** The data adapter that handles reads and writes for this resource. */
  repository: Repository<TRecord, TCreate, TUpdate>
  /**
   * Human-readable resource name (used in error messages and the cache-key namespace).
   * Optional — defaults to a title-cased form of {@link routePrefix} (`'blog-posts'` → `'Blog Posts'`).
   */
  name?: string
  /**
   * Scalar field definitions — control filtering, sorting, selection, and write access.
   *
   * Optional when the {@link repository} exposes its own field schema (e.g. a `PrismaAdapter`
   * built with a `model`, or anything from `createPrismaResources`): in that case the
   * repository's fields are the base, and any entries here are merged over them **by name** as
   * sparse overrides — so you list only the fields you want to change. When the repository
   * exposes no schema, this is the authoritative allow-list and is required.
   */
  fields?: FieldDefinition[]
  /**
   * Relation definitions — control `?include=` access. Merged over the repository's relation
   * schema by name when the repository exposes one; otherwise the authoritative list.
   */
  relations?: RelationDefinition[]
  /**
   * Tenant isolation for this resource. When set (and a tenant resolver is configured
   * on the API), every read/write/bulk operation is constrained to the caller's tenant.
   * Set to `false` to explicitly opt a resource out of an otherwise tenant-scoped API.
   * When omitted, the resource is scoped only if the API's default tenant field exists
   * on this model (auto-detection); otherwise it is treated as global.
   */
  tenant?: TenantResourceConfig | false
  /**
   * CRUD operation toggles. Merged over {@link defaultCrudPermissions}, which enables every
   * action — so you only list the actions you want to **disable** (e.g. `{ allowDeleteMany: false }`).
   */
  permissions?: CrudPermissions
  /** Required permission strings per action (checked by the auth strategy). */
  requiredPermissions?: Partial<Record<CrudAction, string[]>>
  /**
   * Default page size when the caller omits `?limit=`. Defaults to {@link DEFAULT_PAGE_LIMIT}
   * (5000). Set to `0` to apply no default limit (return all rows when `?limit=` is omitted).
   */
  defaultLimit?: number
  /**
   * Hard cap on page size; larger requests are silently capped (the response `count` still
   * reflects the true total). Defaults to {@link MAX_PAGE_LIMIT} (5000). Set to `0` to remove
   * the cap entirely — combine `defaultLimit: 0` and `maxLimit: 0` to disable pagination.
   */
  maxLimit?: number
  /** Maximum nesting depth for WHERE clause children. Defaults to 4. */
  maxFilterDepth?: number
  /**
   * Lifecycle hooks for this resource. Halifax calls these before and after every CRUD
   * operation, letting you inject custom logic — validation, auditing, event emission,
   * data transformation — without writing a custom repository or HTTP middleware.
   *
   * See {@link CrudHooks} for the full list of available hooks and their signatures.
   */
  hooks?: CrudHooks<TRecord, TCreate, TUpdate>
  /**
   * Read-through caching for this resource. When set, the router caches
   * `getOne`/`getMany`/query reads and invalidates them on any write to this resource.
   * Overrides the API-wide default. Omit to inherit the API default (if any); set to
   * `false` to explicitly disable caching for this resource even when a default is configured.
   */
  cache?: ResourceCacheConfig | false
  /**
   * Controls whether this resource is exposed through the GraphQL endpoint.
   * Set to `false` to exclude this resource from the generated GraphQL schema entirely.
   * Defaults to `true` when GraphQL is enabled on the API.
   */
  graphql?: boolean
  /**
   * Roles or permission slugs whose holders may bypass tenant scoping for **read** operations
   * on this resource, allowing them to see records across all tenants. Any single match in
   * `auth.roles` or `auth.permissions` grants the bypass.
   *
   * Bypass callers receive all records on reads. To narrow to a single tenant they use the
   * standard filter mechanism (`?companyId=42` on REST, `filter: { companyId: 42 }` in
   * GraphQL) — the tenant field is just another filterable column from their perspective.
   *
   * Write operations (create / update / delete) are **never** bypassed — tenant value on writes
   * always comes from `resolveId` (the auth token), not from the bypass path.
   *
   * Overrides {@link TenantOptions.bypassRoles} for this resource. Set to `[]` to disable
   * bypass on this resource even when a global `bypassRoles` is configured.
   */
  bypassTenantRoles?: string[]
  /**
   * Wrap every success response body for this resource under a single key
   * (e.g. `'data'` →
   * `{ "data": <body> }`). Applies uniformly to all success payloads — list
   * (`{ data: { count, results } }`), single object, create/update/upsert, and the
   * `{ deleted: true }` confirmation. Error responses are never enveloped.
   * Overrides the API-wide {@link CrudApiOptions.envelope}. Omit (or set `null`/`''`) for
   * a bare body — the default, and backward compatible.
   */
  envelope?: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default page size applied when a resource sets no `defaultLimit` and the caller omits
 * `?limit=`. Chosen as a generous safety ceiling — large enough for typical "show everything"
 * UIs, small enough to prevent a runaway full-table scan. `getMany` always returns the true
 * total `count`, so a page is never a silent drop; a resource can set `defaultLimit: 0` to
 * return all rows by default.
 */
export const DEFAULT_PAGE_LIMIT = 5000

/**
 * Default hard cap on page size applied when a resource sets no `maxLimit`. A resource can set
 * `maxLimit: 0` to remove the cap entirely (no pagination).
 */
export const MAX_PAGE_LIMIT = 5000

/**
 * Default permissions applied to every resource.
 *
 * **Secure-by-default (changed in 3.0.0):** every single-record verb, the query-builder, and the
 * single-record upsert are enabled. Only the **bulk / whole-collection writes** are **off** and must
 * be opted into per resource:
 * - `allowUpdateMany` — `PATCH /{resource}` (mass update)
 * - `allowDeleteMany` — `DELETE /{resource}` (mass delete)
 *
 * A single bad filter on a mass write can mutate or destroy an entire (tenant's) table in one call,
 * so these two are not exposed unless a resource explicitly sets the flag to `true`. Single-record
 * verbs — including `allowUpsertOne` (`PUT /{resource}/:id`), which only ever touches one row — stay
 * on by default.
 */
export const defaultCrudPermissions: Required<CrudPermissions> = {
  allowCreate: true,
  allowReadOne: true,
  allowReadMany: true,
  allowReadManyWithQueryBuilder: true,
  allowUpdateOne: true,
  allowUpdateMany: false,
  allowUpsertOne: true,
  allowDeleteOne: true,
  allowDeleteMany: false
}
