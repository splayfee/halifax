/** A JSON-safe scalar accepted as a stored-procedure argument. */
export type ExecuteScalar = string | number | boolean;
/** A single stored-procedure argument: a scalar or an array of scalars. */
export type ExecuteValue = ExecuteScalar | ExecuteScalar[];
/**
 * The named arguments a caller sends to a stored-procedure endpoint — valid JSON data keyed by the
 * parameter names the procedure declares. This is the request body of a generated `POST /execute/{name}`
 * route.
 */
export type ExecuteParams = Record<string, ExecuteValue>;
/** The JSON type of a declared stored-procedure parameter. */
export type ExecuteParamType = 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]';
/**
 * Declares one parameter of a stored procedure: its name, JSON type, and whether it is required.
 * The server validates incoming {@link ExecuteParams} against these declarations and derives the
 * route's OpenAPI request schema from them.
 */
export interface IExecuteParam {
    /** Parameter name — the key in the request body and the OpenAPI property name. */
    name: string;
    /** JSON type of the value. Defaults to `'string'`. */
    type?: ExecuteParamType;
    /** Whether the caller must supply it. Defaults to `true`. */
    required?: boolean;
    /** Optional human-readable description, surfaced in the OpenAPI docs. */
    description?: string;
}
/**
 * Response body of a stored-procedure endpoint. Routines that return a result set populate `rows`;
 * routines that return nothing (e.g. a Postgres `CALL` procedure) yield an empty `rows` array.
 */
export interface IExecuteResult<TRow = unknown> {
    /** Rows returned by the routine (empty for void routines). */
    rows: TRow[];
    /** Number of rows returned (`rows.length`). */
    rowCount: number;
}
