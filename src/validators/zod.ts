/**
 * Convenience re-export of the zod {@link ISchemaValidator} adapter. The implementation lives in
 * `@edium/halifax-types/zod` so the server and `@edium/halifax-client` share one adapter; this
 * subpath lets consumers of `@edium/halifax` import it without depending on the types package directly.
 *
 * @example
 * ```ts
 * import { zodValidator } from '@edium/halifax/zod'
 * ```
 */
export { zodValidator } from '@edium/halifax-types/zod'
