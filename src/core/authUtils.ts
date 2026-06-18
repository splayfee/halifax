import type { AuthContext, AuthStrategy } from '@/auth/AuthStrategy.js'
import { checkRequiredPermissions } from '@/auth/strategies/types.js'
import { type CrudAction, type ResourceDefinition } from '@/core/types.js'
import type { HttpRequest } from '@/core/types.js'
import { AuthorizationError } from '@/errors/AuthorizationError.js'

/**
 * Runs the auth strategy for `action` and throws {@link AuthorizationError} when not allowed.
 */
export async function authorizeRequest(
  req: HttpRequest,
  resource: ResourceDefinition,
  action: CrudAction,
  authStrategy: AuthStrategy
): Promise<AuthContext> {
  const auth = await authStrategy.authenticate(req)
  const requiredPermissions = resource.requiredPermissions?.[action] ?? []

  if (authStrategy.authorize) {
    const allowed = await authStrategy.authorize({
      auth,
      action,
      resource,
      requiredPermissions,
      req
    })
    if (!allowed) throw new AuthorizationError()
    return auth
  }

  if (!checkRequiredPermissions(auth, requiredPermissions)) throw new AuthorizationError()
  return auth
}
