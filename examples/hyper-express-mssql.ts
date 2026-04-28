import HyperExpress from 'hyper-express'
import { ApiKeyAuthStrategy, HyperExpressHttpServer, InMemoryDataAdapter, registerCrudApi, type ResourceDefinition } from '../src/index.js'

// Development smoke example for the Hyper Express adapter.
// Replace InMemoryDataAdapter with PrismaRepositoryAdapter or SequelizeRepositoryAdapter
// configured for Microsoft SQL Server when running against a real database.

const app = new HyperExpress.Server()
const server = new HyperExpressHttpServer(app)

const users: ResourceDefinition = {
  name: 'User',
  routePrefix: 'users',
  tableName: 'Users',
  fields: [
    { name: 'id', filterable: true, sortable: true, selectable: true },
    { name: 'email', filterable: true, sortable: true, selectable: true, writable: true }
  ],
  permissions: {
    allowCreate: true,
    allowReadOne: true,
    allowReadMany: true,
    allowReadManyWithQueryBuilder: false,
    allowUpdateOne: true,
    allowDeleteOne: true
  },
  repository: new InMemoryDataAdapter([
    { id: 1, email: 'one@example.com' },
    { id: 2, email: 'two@example.com' }
  ])
}

registerCrudApi(server, [users], {
  authStrategy: new ApiKeyAuthStrategy(process.env.API_KEY ?? 'dev-secret')
})

await server.start(Number(process.env.PORT ?? 3000), process.env.HOST ?? '0.0.0.0')
console.log('Halifax Hyper Express dev server listening')
