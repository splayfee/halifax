import { describe, it, expect } from 'vitest'
import { generateOpenApiSpec, generateDocsHtml } from '@/openapi/specGenerator.js'
import type { ResourceDefinition } from '@/core/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal resource definition — only what each test cares about is set explicitly. */
function makeResource(overrides: Partial<ResourceDefinition> = {}): ResourceDefinition {
  return {
    name: 'Post',
    routePrefix: 'posts',
    fields: [
      { name: 'id', writable: false },
      { name: 'title', writable: true }
    ],
    repository: {
      fields: [],
      async getOne() {
        return null
      },
      async getMany() {
        return { count: 0, results: [] }
      },
      async createOne(d) {
        return d as never
      },
      async createMany() {
        return []
      },
      async updateOne() {
        return null
      },
      async deleteOne() {
        return false
      }
    },
    ...overrides
  }
}

// ─── Spec structure ───────────────────────────────────────────────────────────

describe('generateOpenApiSpec — spec structure', () => {
  it('returns openapi 3.1.0 with default info when no options given', () => {
    const spec = generateOpenApiSpec([makeResource()])
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('Halifax API')
    expect(spec.info.version).toBe('1.0.0')
    expect(spec.info.description).toBeUndefined()
  })

  it('uses custom title, version, and description', () => {
    const spec = generateOpenApiSpec([makeResource()], {
      title: 'My API',
      version: '2.0.0',
      description: 'A great API'
    })
    expect(spec.info.title).toBe('My API')
    expect(spec.info.version).toBe('2.0.0')
    expect(spec.info.description).toBe('A great API')
  })

  it('includes servers when provided', () => {
    const spec = generateOpenApiSpec([makeResource()], {
      servers: [{ url: 'https://api.example.com/v1', description: 'Production' }]
    })
    expect(spec.servers).toHaveLength(1)
    expect(spec.servers![0]!.url).toBe('https://api.example.com/v1')
  })

  it('omits servers when not provided', () => {
    const spec = generateOpenApiSpec([makeResource()])
    expect(spec.servers).toBeUndefined()
  })

  it('always includes shared component schemas', () => {
    const spec = generateOpenApiSpec([])
    expect(spec.components.schemas).toHaveProperty('ErrorDetail')
    expect(spec.components.schemas).toHaveProperty('ErrorResponse')
    expect(spec.components.schemas).toHaveProperty('QueryFilter')
    expect(spec.components.schemas).toHaveProperty('QueryOptions')
  })

  it('produces empty paths for zero resources', () => {
    const spec = generateOpenApiSpec([])
    expect(Object.keys(spec.paths)).toHaveLength(0)
  })
})

// ─── Schema naming ────────────────────────────────────────────────────────────

describe('generateOpenApiSpec — schema naming (toPascalCase)', () => {
  it('converts kebab-case routePrefix to PascalCase', () => {
    const spec = generateOpenApiSpec([makeResource({ routePrefix: 'blog-posts' })])
    expect(spec.components.schemas).toHaveProperty('BlogPosts')
  })

  it('converts snake_case routePrefix to PascalCase', () => {
    const spec = generateOpenApiSpec([makeResource({ routePrefix: 'user_accounts' })])
    expect(spec.components.schemas).toHaveProperty('UserAccounts')
  })

  it('handles a simple single-word prefix', () => {
    const spec = generateOpenApiSpec([makeResource({ routePrefix: 'users' })])
    expect(spec.components.schemas).toHaveProperty('Users')
    expect(spec.components.schemas).toHaveProperty('UsersCreate')
    expect(spec.components.schemas).toHaveProperty('UsersList')
  })
})

// ─── Paths per permission ─────────────────────────────────────────────────────

describe('generateOpenApiSpec — route generation by permission', () => {
  const allOff: ResourceDefinition['permissions'] = {
    allowCreate: false,
    allowReadMany: false,
    allowReadManyWithQueryBuilder: false,
    allowReadOne: false,
    allowUpdateOne: false,
    allowUpsertOne: false,
    allowDeleteOne: false,
    allowUpdateMany: false,
    allowDeleteMany: false
  }

  it('allowReadMany → GET /{resource}', () => {
    const spec = generateOpenApiSpec([
      makeResource({ permissions: { ...allOff, allowReadMany: true } })
    ])
    expect(spec.paths['/posts']?.get).toBeDefined()
    expect(spec.paths['/posts']?.post).toBeUndefined()
  })

  it('allowCreate → POST /{resource}', () => {
    const spec = generateOpenApiSpec([
      makeResource({ permissions: { ...allOff, allowCreate: true } })
    ])
    expect(spec.paths['/posts']?.post).toBeDefined()
    expect(spec.paths['/posts']?.get).toBeUndefined()
  })

  it('allowUpdateMany → PATCH /{resource}', () => {
    const spec = generateOpenApiSpec([
      makeResource({ permissions: { ...allOff, allowUpdateMany: true } })
    ])
    expect(spec.paths['/posts']?.patch).toBeDefined()
  })

  it('allowDeleteMany → DELETE /{resource}', () => {
    const spec = generateOpenApiSpec([
      makeResource({ permissions: { ...allOff, allowDeleteMany: true } })
    ])
    expect(spec.paths['/posts']?.delete).toBeDefined()
  })

  it('allowReadManyWithQueryBuilder → POST /{resource}/query', () => {
    const spec = generateOpenApiSpec([
      makeResource({ permissions: { ...allOff, allowReadManyWithQueryBuilder: true } })
    ])
    expect(spec.paths['/posts/query']?.post).toBeDefined()
  })

  it('allowReadOne → GET /{resource}/{id}', () => {
    const spec = generateOpenApiSpec([
      makeResource({ permissions: { ...allOff, allowReadOne: true } })
    ])
    expect(spec.paths['/posts/{id}']?.get).toBeDefined()
  })

  it('allowUpdateOne → PATCH /{resource}/{id}', () => {
    const spec = generateOpenApiSpec([
      makeResource({ permissions: { ...allOff, allowUpdateOne: true } })
    ])
    expect(spec.paths['/posts/{id}']?.patch).toBeDefined()
  })

  it('allowUpsertOne → PUT /{resource}/{id}', () => {
    const spec = generateOpenApiSpec([
      makeResource({ permissions: { ...allOff, allowUpsertOne: true } })
    ])
    expect(spec.paths['/posts/{id}']?.put).toBeDefined()
  })

  it('allowDeleteOne → DELETE /{resource}/{id}', () => {
    const spec = generateOpenApiSpec([
      makeResource({ permissions: { ...allOff, allowDeleteOne: true } })
    ])
    expect(spec.paths['/posts/{id}']?.delete).toBeDefined()
  })

  it('all permissions on by default — all routes exist', () => {
    const spec = generateOpenApiSpec([makeResource()])
    expect(spec.paths['/posts']?.get).toBeDefined()
    expect(spec.paths['/posts']?.post).toBeDefined()
    expect(spec.paths['/posts']?.patch).toBeDefined()
    expect(spec.paths['/posts']?.delete).toBeDefined()
    expect(spec.paths['/posts/query']?.post).toBeDefined()
    expect(spec.paths['/posts/{id}']?.get).toBeDefined()
    expect(spec.paths['/posts/{id}']?.patch).toBeDefined()
    expect(spec.paths['/posts/{id}']?.put).toBeDefined()
    expect(spec.paths['/posts/{id}']?.delete).toBeDefined()
  })

  it('operationId follows the naming convention', () => {
    const spec = generateOpenApiSpec([makeResource({ routePrefix: 'posts' })])
    expect(spec.paths['/posts']?.get?.operationId).toBe('listPosts')
    expect(spec.paths['/posts']?.post?.operationId).toBe('createPosts')
    expect(spec.paths['/posts/{id}']?.get?.operationId).toBe('getPosts')
    expect(spec.paths['/posts/{id}']?.patch?.operationId).toBe('updatePosts')
    expect(spec.paths['/posts/{id}']?.put?.operationId).toBe('upsertPosts')
    expect(spec.paths['/posts/{id}']?.delete?.operationId).toBe('deletePosts')
  })
})

// ─── Field type mapping ───────────────────────────────────────────────────────

describe('generateOpenApiSpec — field type mapping (fieldToSchema)', () => {
  function schemaProps(routePrefix: string, spec: ReturnType<typeof generateOpenApiSpec>) {
    const name = routePrefix.charAt(0).toUpperCase() + routePrefix.slice(1)
    return spec.components.schemas[name]?.properties ?? {}
  }

  it('maps integer type', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        routePrefix: 'items',
        fields: [{ name: 'count', type: 'integer' }]
      })
    ])
    expect(schemaProps('items', spec)['count']).toMatchObject({ type: 'integer' })
  })

  it('maps integer with format', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        routePrefix: 'items',
        fields: [{ name: 'bigNum', type: 'integer', format: 'int64' }]
      })
    ])
    expect(schemaProps('items', spec)['bigNum']).toMatchObject({ type: 'integer', format: 'int64' })
  })

  it('maps number type', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        routePrefix: 'items',
        fields: [{ name: 'price', type: 'number' }]
      })
    ])
    expect(schemaProps('items', spec)['price']).toMatchObject({ type: 'number' })
  })

  it('maps number with format (float)', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        routePrefix: 'items',
        fields: [{ name: 'score', type: 'number', format: 'float' }]
      })
    ])
    expect(schemaProps('items', spec)['score']).toMatchObject({ type: 'number', format: 'float' })
  })

  it('maps boolean type', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        routePrefix: 'items',
        fields: [{ name: 'active', type: 'boolean' }]
      })
    ])
    expect(schemaProps('items', spec)['active']).toMatchObject({ type: 'boolean' })
  })

  it('maps object type', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        routePrefix: 'items',
        fields: [{ name: 'meta', type: 'object' }]
      })
    ])
    expect(schemaProps('items', spec)['meta']).toMatchObject({ type: 'object' })
  })

  it('defaults to string when type is undefined', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        routePrefix: 'items',
        fields: [{ name: 'title' }]
      })
    ])
    expect(schemaProps('items', spec)['title']).toMatchObject({ type: 'string' })
  })

  it('maps string with format (e.g. date-time)', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        routePrefix: 'items',
        fields: [{ name: 'createdAt', format: 'date-time' }]
      })
    ])
    expect(schemaProps('items', spec)['createdAt']).toMatchObject({
      type: 'string',
      format: 'date-time'
    })
  })

  it('marks non-writable fields as readOnly in read schema', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        routePrefix: 'items',
        fields: [
          { name: 'id', writable: false },
          { name: 'title', writable: true }
        ]
      })
    ])
    expect(schemaProps('items', spec)['id']).toMatchObject({ readOnly: true })
    expect(schemaProps('items', spec)['title']?.readOnly).toBeUndefined()
  })

  it('excludes non-selectable fields from read schema', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        routePrefix: 'items',
        fields: [{ name: 'id' }, { name: 'secret', selectable: false }]
      })
    ])
    const props = schemaProps('items', spec)
    expect(props).toHaveProperty('id')
    expect(props).not.toHaveProperty('secret')
  })
})

// ─── Envelope wrapping ────────────────────────────────────────────────────────

describe('generateOpenApiSpec — envelope wrapping', () => {
  it('wraps list response under envelope key when set globally', () => {
    const spec = generateOpenApiSpec([makeResource()], { envelope: 'data' })
    const listSchema = spec.components.schemas['PostsList']
    expect(listSchema?.type).toBe('object')
    expect(listSchema?.properties).toHaveProperty('data')
  })

  it('no envelope by default — list schema is a bare ListResult', () => {
    const spec = generateOpenApiSpec([makeResource()])
    const listSchema = spec.components.schemas['PostsList']
    expect(listSchema?.properties).toHaveProperty('count')
    expect(listSchema?.properties).toHaveProperty('results')
  })

  it('per-resource envelope overrides the global envelope', () => {
    const spec = generateOpenApiSpec([makeResource({ envelope: 'payload' })], { envelope: 'data' })
    const listSchema = spec.components.schemas['PostsList']
    // 'payload' (per-resource) should win over 'data' (global)
    expect(listSchema?.properties).toHaveProperty('payload')
    expect(listSchema?.properties).not.toHaveProperty('data')
  })

  it('per-resource envelope: null suppresses the global envelope', () => {
    const spec = generateOpenApiSpec([makeResource({ envelope: null })], { envelope: 'data' })
    const listSchema = spec.components.schemas['PostsList']
    expect(listSchema?.properties).toHaveProperty('count')
    expect(listSchema?.properties).not.toHaveProperty('data')
  })
})

// ─── Security schemes ─────────────────────────────────────────────────────────

describe('generateOpenApiSpec — security schemes', () => {
  it('adds apiKey scheme under ApiKeyAuth', () => {
    const spec = generateOpenApiSpec([makeResource()], {
      securityScheme: { type: 'apiKey', in: 'header', name: 'X-Api-Key' }
    })
    expect(spec.components.securitySchemes).toHaveProperty('ApiKeyAuth')
    expect(spec.components.securitySchemes!['ApiKeyAuth']).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-Api-Key'
    })
    expect(spec.security).toEqual([{ ApiKeyAuth: [] }])
  })

  it('adds apiKey cookie scheme under SessionAuth', () => {
    const spec = generateOpenApiSpec([makeResource()], {
      securityScheme: { type: 'apiKey', in: 'cookie', name: 'session' }
    })
    expect(spec.components.securitySchemes).toHaveProperty('SessionAuth')
  })

  it('adds HTTP bearer scheme under BearerAuth', () => {
    const spec = generateOpenApiSpec([makeResource()], {
      securityScheme: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
    })
    expect(spec.components.securitySchemes).toHaveProperty('BearerAuth')
    expect(spec.components.securitySchemes!['BearerAuth']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT'
    })
  })

  it('adds HTTP basic scheme under BasicAuth', () => {
    const spec = generateOpenApiSpec([makeResource()], {
      securityScheme: { type: 'http', scheme: 'basic' }
    })
    expect(spec.components.securitySchemes).toHaveProperty('BasicAuth')
  })

  it('includes scheme description when provided', () => {
    const spec = generateOpenApiSpec([makeResource()], {
      securityScheme: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Api-Key',
        description: 'Pass your key'
      }
    })
    const scheme = spec.components.securitySchemes!['ApiKeyAuth'] as { description?: string }
    expect(scheme.description).toBe('Pass your key')
  })

  it('no security when no scheme provided', () => {
    const spec = generateOpenApiSpec([makeResource()])
    expect(spec.security).toBeUndefined()
    expect(spec.components.securitySchemes).toBeUndefined()
  })
})

// ─── Relations (include param) ────────────────────────────────────────────────

describe('generateOpenApiSpec — relations', () => {
  it('adds ?include query param when resource has includable relations', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        relations: [{ name: 'author', includable: true }]
      })
    ])
    const params = spec.paths['/posts']?.get?.parameters ?? []
    const includeParam = params.find((p: { name: string }) => p.name === 'include')
    expect(includeParam).toBeDefined()
  })

  it('does not add ?include when there are no includable relations', () => {
    const spec = generateOpenApiSpec([makeResource({ relations: [] })])
    const params = spec.paths['/posts']?.get?.parameters ?? []
    const includeParam = params.find((p: { name: string }) => p.name === 'include')
    expect(includeParam).toBeUndefined()
  })
})

// ─── mergeFields ─────────────────────────────────────────────────────────────

describe('generateOpenApiSpec — mergeFields', () => {
  it('inherits fields from repository.fields', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        repository: {
          fields: [{ name: 'id', writable: false }, { name: 'title' }],
          async getOne() {
            return null
          },
          async getMany() {
            return { count: 0, results: [] }
          },
          async createOne(d) {
            return d as never
          },
          async createMany() {
            return []
          },
          async updateOne() {
            return null
          },
          async deleteOne() {
            return false
          }
        }
      })
    ])
    const props = spec.components.schemas['Posts']?.properties ?? {}
    expect(props).toHaveProperty('id')
    expect(props).toHaveProperty('title')
  })

  it('resource.fields override repository.fields for the same field name', () => {
    const spec = generateOpenApiSpec([
      makeResource({
        fields: [{ name: 'title', type: 'integer' }],
        repository: {
          fields: [{ name: 'title', type: 'string' }],
          async getOne() {
            return null
          },
          async getMany() {
            return { count: 0, results: [] }
          },
          async createOne(d) {
            return d as never
          },
          async createMany() {
            return []
          },
          async updateOne() {
            return null
          },
          async deleteOne() {
            return false
          }
        }
      })
    ])
    const props = spec.components.schemas['Posts']?.properties ?? {}
    expect(props['title']).toMatchObject({ type: 'integer' })
  })
})

// ─── Multiple resources ────────────────────────────────────────────────────────

describe('generateOpenApiSpec — multiple resources', () => {
  it('registers paths for each resource', () => {
    const spec = generateOpenApiSpec([
      makeResource({ name: 'Post', routePrefix: 'posts' }),
      makeResource({ name: 'Comment', routePrefix: 'comments' })
    ])
    expect(spec.paths).toHaveProperty('/posts')
    expect(spec.paths).toHaveProperty('/comments')
  })
})

// ─── generateDocsHtml ────────────────────────────────────────────────────────

describe('generateDocsHtml', () => {
  it('returns an HTML document string', () => {
    const html = generateDocsHtml('/openapi.json', '/docs')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('swagger-ui')
  })

  it('embeds a relative URL to the spec from the docs page', () => {
    // /docs is in the root, /openapi.json is in the root → just 'openapi.json'
    const html = generateDocsHtml('/openapi.json', '/docs')
    expect(html).toContain('openapi.json')
  })

  it('computes correct relative URL when spec is in a subdirectory of root docs', () => {
    // docs at /docs (root-level), spec at /api/openapi.json → 'api/openapi.json'
    const html = generateDocsHtml('/api/openapi.json', '/docs')
    expect(html).toContain('api/openapi.json')
  })

  it('computes correct relative URL when docs are deeper than spec', () => {
    // docs at /v1/docs, spec at /openapi.json → '../openapi.json'
    const html = generateDocsHtml('/openapi.json', '/v1/docs')
    expect(html).toContain('../openapi.json')
  })

  it('computes correct relative URL when both are in the same subdir', () => {
    // docs at /api/docs, spec at /api/openapi.json → 'openapi.json'
    const html = generateDocsHtml('/api/openapi.json', '/api/docs')
    expect(html).toContain('openapi.json')
  })
})
