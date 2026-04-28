import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { InMemoryDataAdapter } from '@/adapters/data/InMemoryDataAdapter.js'
import { createExpressCrudRouter } from '@/adapters/http/express.js'
import { ApiKeyAuthStrategy } from '@/auth/AuthStrategy.js'
import { ResourceDefinition } from '@/core/types.js'

function createApp() {
  const app = express()
  app.use(express.json())

  const resource: ResourceDefinition = {
    name: 'User',
    routePrefix: 'users',
    fields: [{ name: 'id' }, { name: 'email' }],
    permissions: {
      allowCreate: true,
      allowReadOne: true,
      allowReadMany: true,
      allowUpdateOne: true,
      allowDeleteOne: true
    },
    repository: new InMemoryDataAdapter([
      { id: 1, email: 'one@example.com' },
      { id: 2, email: 'two@example.com' }
    ])
  }

  app.use('/api/v1', createExpressCrudRouter([resource], { authStrategy: new ApiKeyAuthStrategy('secret') }))
  return app
}

describe('createExpressCrudRouter', () => {
  it('blocks unauthorized requests', async () => {
    const response = await request(createApp()).get('/api/v1/users')
    expect(response.status).toBe(403)
  })

  it('reads many records', async () => {
    const response = await request(createApp()).get('/api/v1/users').set('x-api-key', 'secret')
    expect(response.status).toBe(200)
    expect(response.body.count).toBe(2)
  })
})
