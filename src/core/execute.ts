import type {
  ExecuteParams,
  ExecuteParamType,
  ExecuteValue,
  FieldError,
  IExecuteParam,
  JsonSchema
} from '@edium/halifax-types'
import type { CustomEndpointOpenApi } from '@/core/customEndpoint.js'
import type { HalifaxApi } from '@/core/router/halifaxApi.js'
import { ServerError } from '@/errors/ServerError.js'
import { UnprocessableEntityError } from '@/errors/UnprocessableEntityError.js'

/**
 * Calls a database routine (stored procedure or function) by **exact name** with positional,
 * parameter-bound arguments — supplied in the order the procedure declares its parameters —
 * returning its rows (empty for void routines). Implementations MUST bind values as query
 * parameters (never string-interpolate them). Halifax ships {@link PrismaSqlExecutor} and
 * {@link DrizzleSqlExecutor}; provide your own for any other data source.
 */
export interface SqlExecutor {
  /**
   * @param name - Database routine name.
   * @param params - Positional argument values, in declaration order.
   * @returns The routine's result rows (empty array for void routines).
   */
  call(name: string, params: ExecuteValue[]): Promise<unknown[]>
}

/**
 * A registered stored procedure. Each becomes its **own** documented `POST` route — at
 * `${basePath}/${kebab(name)}` by default (e.g. `get_report` → `/execute/get-report`), or at a
 * `path` you supply. The `name` is required; it is the routine actually invoked in SQL.
 */
export interface ExecuteProcedure {
  /** Database routine name (required) — used verbatim (validated + quoted) in the SQL call. */
  name: string
  /**
   * Ordered parameter declarations. The order defines positional binding (`$1..$n`). The request
   * body is a JSON object keyed by these `name`s; it is validated against the declarations and a
   * `422` is returned for a missing required, unknown, or wrong-typed parameter.
   */
  params?: IExecuteParam[]
  /**
   * Roles/permissions required to call this procedure (OR-match). `[]` = any authenticated caller;
   * `null` = public. Defaults to {@link ExecuteOptions.roles}.
   */
  roles?: string[] | null
  /**
   * Route override. A value starting with `/` is the full route path (relative to the API mount);
   * otherwise it is a single path segment under `basePath`. Defaults to the kebab-cased `name`.
   */
  path?: string
  /** OpenAPI summary for the generated operation. */
  summary?: string
  /** OpenAPI description for the generated operation. */
  description?: string
}

/**
 * Configuration for stored-procedure endpoints. Like GraphQL, this is **off by default** — routes
 * are registered only when this object is supplied. Every entry in `procedures` becomes its own
 * auto-documented `POST` route.
 */
export interface ExecuteOptions {
  /** The executor that runs routines (e.g. {@link PrismaSqlExecutor}). */
  executor: SqlExecutor
  /** Registered stored procedures — one generated route + OpenAPI operation each. */
  procedures: ExecuteProcedure[]
  /** Base path prefix for generated routes (default `'/execute'`). */
  basePath?: string
  /** Default authorization for every generated route (`[]` = any authenticated; `null` = public). */
  roles?: string[] | null
}

/** Converts a routine name (snake_case, camelCase, dotted) to a kebab-case URL segment. */
function toKebabCase(name: string): string {
  return name
    .replace(/[_.\s]+/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/-+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '')
}

/** JSON Schema node for a declared parameter type. */
function paramSchema(type: ExecuteParamType = 'string'): JsonSchema {
  switch (type) {
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'string[]':
      return { type: 'array', items: { type: 'string' } }
    case 'number[]':
      return { type: 'array', items: { type: 'number' } }
    case 'boolean[]':
      return { type: 'array', items: { type: 'boolean' } }
    case 'string':
    default:
      return { type: 'string' }
  }
}

/** Returns true when a scalar matches the declared base type. */
function matchesScalar(value: unknown, base: string): boolean {
  if (base === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (base === 'boolean') return typeof value === 'boolean'
  return typeof value === 'string'
}

/** Returns true when a provided value matches the declared parameter type. */
function matchesType(value: unknown, type: ExecuteParamType = 'string'): boolean {
  if (type.endsWith('[]'))
    return Array.isArray(value) && value.every((v) => matchesScalar(v, type.slice(0, -2)))
  return matchesScalar(value, type)
}

type ValidatedParams = { ok: true; ordered: ExecuteValue[] } | { ok: false; errors: FieldError[] }

/**
 * Validates a request's named params against the declared spec and, on success, returns the values
 * ordered for positional binding. Rejects unknown params, missing required params, and type
 * mismatches — collecting every failure.
 */
function validateParams(declared: IExecuteParam[], provided: ExecuteParams): ValidatedParams {
  const errors: FieldError[] = []
  const declaredNames = new Set(declared.map((d) => d.name))
  for (const key of Object.keys(provided))
    if (!declaredNames.has(key)) errors.push({ path: key, message: `Unknown parameter '${key}'.` })

  const ordered: ExecuteValue[] = []
  for (const param of declared) {
    const value = provided[param.name]
    const required = param.required !== false
    if (value === undefined || value === null) {
      if (required)
        errors.push({ path: param.name, message: `Parameter '${param.name}' is required.` })
      // Positional placeholder keeps later args aligned for an omitted optional param.
      ordered.push(null as unknown as ExecuteValue)
      continue
    }
    if (!matchesType(value, param.type)) {
      errors.push({
        path: param.name,
        message: `Parameter '${param.name}' must be of type ${param.type ?? 'string'}.`
      })
      ordered.push(value)
      continue
    }
    ordered.push(value)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, ordered }
}

/** Builds the per-procedure OpenAPI operation from its declared parameters. */
function buildProcedureOpenApi(proc: ExecuteProcedure): CustomEndpointOpenApi {
  const declared = proc.params ?? []
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const p of declared) {
    const schema = paramSchema(p.type)
    if (p.description) schema.description = p.description
    properties[p.name] = schema
    if (p.required !== false) required.push(p.name)
  }
  const bodySchema: JsonSchema = { type: 'object', properties, additionalProperties: false }
  if (required.length > 0) bodySchema.required = required

  return {
    summary: proc.summary ?? `Execute ${proc.name}`,
    description: proc.description ?? `Calls the \`${proc.name}\` database routine.`,
    tags: ['Execute'],
    requestBody: {
      required: required.length > 0,
      content: { 'application/json': { schema: bodySchema } }
    },
    responses: {
      '200': {
        description: 'Routine result rows.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { rows: { type: 'array', items: {} }, rowCount: { type: 'integer' } }
            }
          }
        }
      }
    }
  }
}

/** Resolves a procedure's route path: explicit absolute, explicit segment, or kebab-cased name. */
function resolvePath(basePath: string, proc: ExecuteProcedure): string {
  if (proc.path && proc.path.startsWith('/')) return proc.path
  const segment = proc.path ?? toKebabCase(proc.name)
  return `${basePath}/${segment}`
}

/**
 * Registers one `POST` route per configured stored procedure on the given {@link HalifaxApi}. Each
 * route:
 * 1. is documented in OpenAPI from the procedure's declared parameters;
 * 2. validates the JSON request body against those parameters (`422` on a missing required, unknown,
 *    or wrong-typed value);
 * 3. binds the values positionally and invokes the {@link SqlExecutor}, returning `{ rows, rowCount }`.
 *
 * Called by `registerCrudApi` only when `options.execute` is set, so the routes are off by default.
 * @throws {@link ServerError} when a procedure is missing its required `name`.
 */
export function registerExecuteEndpoint(api: HalifaxApi, options: ExecuteOptions): void {
  const basePath = options.basePath ?? '/execute'
  const defaultRoles = options.roles === undefined ? [] : options.roles

  for (const proc of options.procedures) {
    if (!proc.name) throw new ServerError('Each execute procedure requires a `name`.')
    const path = resolvePath(basePath, proc)
    const declared = proc.params ?? []
    const roles = proc.roles === undefined ? defaultRoles : proc.roles

    api.addCustomEndpoint(
      'POST',
      path,
      { roles, openapi: buildProcedureOpenApi(proc) },
      async (req, res) => {
        const body = req.body
        if (typeof body !== 'object' || body === null || Array.isArray(body))
          throw new UnprocessableEntityError(
            'Request body must be a JSON object of named parameters.'
          )

        const result = validateParams(declared, body as ExecuteParams)
        if (!result.ok)
          throw new UnprocessableEntityError('Parameter validation failed.', {
            fieldErrors: result.errors
          })

        const rows = await options.executor.call(proc.name, result.ordered)
        await res.status(200).json({ rows, rowCount: rows.length })
      }
    )
  }
}
