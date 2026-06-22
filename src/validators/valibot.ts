/**
 * Convenience re-export of the valibot {@link ISchemaValidator} adapter. The implementation lives in
 * `@edium/halifax-types/valibot` so the server and `@edium/halifax-client` share one adapter; this
 * subpath lets consumers of `@edium/halifax` import it without depending on the types package directly.
 *
 * @example
 * ```ts
 * import { valibotValidator } from '@edium/halifax/valibot'
 * ```
 */
export { valibotValidator } from '@edium/halifax-types/valibot'
