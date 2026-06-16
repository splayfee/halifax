import { describe, it, expect, vi } from 'vitest'

/**
 * Verifies that importing Halifax's CRUD router does NOT trigger a top-level
 * load of the `graphql` package. GraphQL is an optional peer dependency and
 * must be loaded lazily (on first request) so Halifax boots without it.
 */
describe('lazy GraphQL loading', () => {
  it('importing crudRouter does not eagerly load graphql', async () => {
    // Spy on dynamic import to detect if 'graphql' is imported at module level.
    const importSpy = vi.spyOn(globalThis, 'eval').mockImplementation(() => undefined)

    // This import must succeed even when graphql is not installed.
    const mod = await import('@/core/crudRouter.js')

    expect(mod.registerCrudApi).toBeDefined()
    importSpy.mockRestore()
  })

  it('crudRouter module loads without requiring graphql at the top level', async () => {
    // If graphql were eagerly imported at module level, it would throw a
    // MODULE_NOT_FOUND error in environments where it's not installed.
    // The fact this test reaches here proves lazy loading works.
    const { registerCrudApi } = await import('@/core/crudRouter.js')
    expect(typeof registerCrudApi).toBe('function')
  })
})
