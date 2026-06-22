/**
 * Convenience re-export of the yup {@link ISchemaValidator} adapter. The implementation lives in
 * `@edium/halifax-types/yup` so the server and `@edium/halifax-client` share one adapter; this
 * subpath lets consumers of `@edium/halifax` import it without depending on the types package directly.
 *
 * @example
 * ```ts
 * import { yupValidator } from '@edium/halifax/yup'
 * ```
 */
export { yupValidator } from '@edium/halifax-types/yup'
