import { createAppHttpServer } from './http-server.js'
import { createRuntimeFromEnvironment } from './persistence/runtime-environment.js'

const port = Number(process.env.API_PORT ?? 8787)
const runtime = createRuntimeFromEnvironment()
if (process.env.ADMIN_PASSWORD) {
  const provisioned = await runtime.provisionAdmin({ password: process.env.ADMIN_PASSWORD })
  if (!provisioned.ok) throw new Error(`Admin provisioning failed: ${provisioned.code}`)
}
const server = createAppHttpServer({ api: runtime.api })
server.listen(port, '127.0.0.1', () => console.log(`Local API listening on http://127.0.0.1:${port}`))

function shutdown() {
  server.close(() => {
    runtime.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
