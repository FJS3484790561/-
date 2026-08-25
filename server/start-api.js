import { createAppRuntime } from './app-runtime.js'
import { createAppHttpServer } from './http-server.js'

const port = Number(process.env.API_PORT ?? 8787)
const runtime = createAppRuntime({ secureCookies: process.env.NODE_ENV === 'production', adminEmail: process.env.ADMIN_EMAIL ?? 'admin@example.com' })
if (process.env.ADMIN_PASSWORD) {
  const provisioned = await runtime.provisionAdmin({ password: process.env.ADMIN_PASSWORD })
  if (!provisioned.ok) throw new Error(`Admin provisioning failed: ${provisioned.code}`)
}
const server = createAppHttpServer({ api: runtime.api })
server.listen(port, '127.0.0.1', () => console.log(`Local API listening on http://127.0.0.1:${port}`))
