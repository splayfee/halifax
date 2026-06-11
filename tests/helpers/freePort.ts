import net from 'node:net'

/**
 * Finds an available TCP port by binding to port 0 and reading the OS-assigned port.
 *
 * Needed for the uWebSockets-based adapters (HyperExpress, Ultimate Express): unlike
 * Express and Fastify, their apps are not Node `http.Server` instances, so supertest must
 * talk to a really-listening server over a URL rather than an in-process handle.
 *
 * @returns A promise resolving to a free port on `127.0.0.1`.
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close(() => resolve(port))
    })
  })
}
