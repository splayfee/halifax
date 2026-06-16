/**
 * OpenAPI-compatible scalar type for a field. Used for spec generation only — has no effect
 * on runtime behaviour. Auto-populated by `PrismaAdapter`; set manually for custom repositories.
 */
export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'object'

/**
 * Describes a single column exposed through the Halifax API.
 *
 * Every flag is **permissive by default** — only set one to `false` to restrict a field.
 * A field with just `{ name }` is filterable, sortable, selectable, and writable. The lone
 * exception is the primary key, which is non-writable by default (it comes from the URL / DB);
 * set `writable: true` on it explicitly if you really want clients to supply it.
 */
export interface FieldDefinition {
  /** Column / property name. */
  name: string
  /** When `false`, the field cannot be used in `?field=` filters. Defaults to `true`. */
  filterable?: boolean
  /** When `false`, the field cannot be used in `?order=` sorts. Defaults to `true`. */
  sortable?: boolean
  /** When `false`, the field is excluded from `?fields=` projections. Defaults to `true`. */
  selectable?: boolean
  /** When `false`, the field is stripped from POST/PATCH/PUT bodies. Defaults to `true` (except the primary key). */
  writable?: boolean
  /** OpenAPI scalar type. Auto-populated from Prisma DMMF; set manually for non-Prisma fields. Defaults to `'string'`. */
  type?: FieldType
  /** OpenAPI format modifier (e.g. `'date-time'`, `'int64'`, `'binary'`). Auto-populated from Prisma DMMF. */
  format?: string
  /**
   * Roles or permissions required to **read** this field. Any single match grants access.
   * When absent or empty, any authenticated caller can read the field (no restriction).
   * Values are matched against `AuthContext.roles` and `AuthContext.permissions`.
   */
  readRoles?: string[]
  /**
   * Roles or permissions required to **write** this field. Any single match grants access.
   * Fields the caller cannot write are silently dropped from POST/PATCH/PUT bodies
   * (consistent with how `writable: false` behaves). When absent or empty, any caller
   * with general write access can write this field.
   * Values are matched against `AuthContext.roles` and `AuthContext.permissions`.
   */
  writeRoles?: string[]
}

/**
 * Declares that a resource is tenant-scoped: every request is confined to rows whose
 * {@link TenantResourceConfig.field} equals the tenant value resolved for the caller.
 * Omit `tenant` (or set it to `false`) to expose a resource globally / unscoped.
 */
export interface TenantResourceConfig {
  /** Column / property on this model that stores the tenant key (e.g. `'companyId'`). */
  field: string
}

/** Describes a relation that callers may eagerly load via `?include=`. */
export interface RelationDefinition {
  /** Relation name as defined on the Prisma model. */
  name: string
  /** When `false`, this relation cannot be requested via `?include=`. */
  includable?: boolean
}
