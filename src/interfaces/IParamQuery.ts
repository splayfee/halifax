/** A compiled SQL statement with its positional parameters. */
export interface IParamQuery {
  /** The SQL string with `$1`, `$2`, … placeholders. */
  statement: string
  /** Values bound to each placeholder in order. */
  parameters: unknown[]
}
