/**
 * Convenience re-export of the joi {@link ISchemaValidator} adapter. The implementation lives in
 * `@edium/halifax-types/joi` so the server and `@edium/halifax-client` share one adapter; this
 * subpath lets consumers of `@edium/halifax` import it without depending on the types package directly.
 *
 * @example
 * ```ts
 * import { joiValidator } from '@edium/halifax/joi'
 * ```
 */
export { joiValidator } from '@edium/halifax-types/joi'
