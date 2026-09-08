import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteStores } from './persistence/sqlite-stores.js'
import { appApiConstants } from './app-api.js'
import { createAppRuntime } from './app-runtime.js'
import { createAppHttpServer } from './http-server.js'

async function call(api, path, { method = 'GET', body, cookie, contentType = 'application/json' } = {}) {
  const headers = {}
  if (method !== 'GET') headers.origin = 'http://app.local'
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = contentType
  const response = await api.handle(new Request(`http://app.local${path}`, { method, headers, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }))
  return { response, data: await response.json(), cookie: response.headers.get('set-cookie') }
}

async function registerAndLogin(api, email) {
  assert.equal((await call(api, '/api/auth/register', { method: 'POST', body: { email, password: 'correct-horse' } })).response.status, 201)
  return login(api, email)
}

async function login(api, email) {
  const result = await call(api, '/api/auth/login', { method: 'POST', body: { email, password: 'correct-horse' } })
  assert.equal(result.response.status, 200)
  return result.cookie.split(';')[0]
}

test('serves health and safe not found responses over a real HTTP server', async () => {
  const runtime = createAppRuntime()
  const server = createAppHttpServer({ api: runtime.api })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const health = await fetch(`http://127.0.0.1:${address.port}/api/health`)
    assert.deepEqual(await health.json(), { ok: true, status: 'ready' })
    const missing = await fetch(`http://127.0.0.1:${address.port}/api/missing`)
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { ok: false, code: 'NOT_FOUND' })
    const missingPost = await fetch(`http://127.0.0.1:${address.port}/api/missing`, { method: 'POST', headers: { origin: `http://127.0.0.1:${address.port}` } })
    assert.equal(missingPost.status, 404)
    assert.deepEqual(await missingPost.json(), { ok: false, code: 'NOT_FOUND' })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('overview route enforces sessions, admin permission and returns live SQLite aggregates without caching', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'overview-api-'))
  const stores = createSqliteStores({ filename: join(directory, 'app.sqlite') })
  const runtime = createAppRuntime({ stores })
  try {
    assert.equal((await call(runtime.api, '/api/admin/overview')).response.status, 401)
    await runtime.provisionAdmin({ password: 'correct-horse' })
    const adminCookie = await login(runtime.api, 'admin@example.com')
    const userCookie = await registerAndLogin(runtime.api, 'overview-user@example.com')
    assert.equal((await call(runtime.api, '/api/admin/overview', { cookie: userCookie })).response.status, 403)
    const overview = await call(runtime.api, '/api/admin/overview', { cookie: adminCookie })
    assert.equal(overview.response.status, 200)
    assert.equal(overview.response.headers.get('cache-control'), 'no-store')
    assert.equal(overview.data.overview.users.total, 2)
    await call(runtime.api, '/api/admin/redemption-codes', { method: 'POST', cookie: adminCookie, body: { credits: 4, maxRedemptions: 3 } })
    assert.deepEqual((await call(runtime.api, '/api/admin/overview', { cookie: adminCookie })).data.overview.redemptionCodes, { total: 1, redemptions: 0, remaining: 3 })
    await call(runtime.api, '/api/auth/logout', { method: 'POST', cookie: adminCookie, body: {} })
    assert.equal((await call(runtime.api, '/api/admin/overview', { cookie: adminCookie })).response.status, 401)
  } finally { stores.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('overview route reports missing persistence as 503, not zero statistics', async () => {
  const runtime = createAppRuntime()
  await runtime.provisionAdmin({ password: 'correct-horse' })
  const cookie = await login(runtime.api, 'admin@example.com')
  const result = await call(runtime.api, '/api/admin/overview', { cookie })
  assert.equal(result.response.status, 503)
  assert.deepEqual(result.data, { ok: false, code: 'OVERVIEW_UNAVAILABLE' })
})

test('uses HttpOnly session cookies and supports password reset without token disclosure', async () => {
  let resetMessage
  const runtime = createAppRuntime({ mailer: { sendPasswordReset: async (message) => { resetMessage = message } } })
  const register = await call(runtime.api, '/api/auth/register', { method: 'POST', body: { email: 'user@example.com', password: 'correct-horse' } })
  assert.equal(register.response.status, 201)
  const login = await call(runtime.api, '/api/auth/login', { method: 'POST', body: { email: 'user@example.com', password: 'correct-horse' } })
  assert.match(login.cookie, /^session=.+; Path=\/; HttpOnly; SameSite=Lax;/u)
  assert.equal(JSON.stringify(login.data).includes('sessionToken'), false)
  const sessionCookie = login.cookie.split(';')[0]
  assert.equal((await call(runtime.api, '/api/auth/session', { cookie: sessionCookie })).data.user.email, 'user@example.com')
  assert.equal((await call(runtime.api, '/api/auth/session')).response.status, 401)

  const reset = await call(runtime.api, '/api/auth/password-reset/request', { method: 'POST', body: { email: 'user@example.com' } })
  assert.deepEqual(reset.data, { ok: true })
  assert.equal(JSON.stringify(reset.data).includes(resetMessage.token), false)
  assert.deepEqual((await call(runtime.api, '/api/auth/password-reset/confirm', { method: 'POST', body: { token: resetMessage.token, password: 'new-password' } })).data, { ok: true })

  const logout = await call(runtime.api, '/api/auth/logout', { method: 'POST', body: {}, cookie: sessionCookie })
  assert.match(logout.cookie, /Max-Age=0/u)
  assert.equal((await call(runtime.api, '/api/auth/logout', { method: 'POST', body: {} })).response.status, 200)
})

test('routes generation through existing validation and isolates task ownership', async () => {
  const runtime = createAppRuntime()
  const userCookie = await registerAndLogin(runtime.api, 'user@example.com')
  const otherCookie = await registerAndLogin(runtime.api, 'other@example.com')
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
  const created = await call(runtime.api, '/api/generations', { method: 'POST', cookie: userCookie, body: { image: { name: 'room.png', type: 'image/png', dataBase64: png.toString('base64') }, params: { room: '客厅', theme: '现代简约', scale: '均衡', preferences: { layout: true } } } })
  assert.equal(created.response.status, 202)
  await runtime.generationService.waitForGeneration(created.data.task.id)
  const ownTask = await call(runtime.api, `/api/generations/${created.data.task.id}`, { cookie: userCookie })
  assert.equal(ownTask.data.task.status, 'succeeded')
  assert.equal((await call(runtime.api, `/api/generations/${created.data.task.id}`, { cookie: otherCookie })).response.status, 404)
  assert.equal((await call(runtime.api, '/api/generations', { method: 'POST', body: {} })).response.status, 401)
})

test('exposes credits, works and orders while preserving user isolation', async () => {
  const runtime = createAppRuntime()
  const userCookie = await registerAndLogin(runtime.api, 'user@example.com')
  const otherCookie = await registerAndLogin(runtime.api, 'other@example.com')
  assert.equal((await call(runtime.api, '/api/credits', { cookie: userCookie })).data.available, 3)
  const work = await call(runtime.api, '/api/works', { method: 'POST', cookie: userCookie, body: { sessionToken: 'client-cannot-override-cookie', generationId: 'generation_1', original: { url: '/original.png' }, effectImage: { url: '/effect.png' }, params: { room: '客厅' } } })
  assert.equal(work.response.status, 201)
  assert.equal((await call(runtime.api, '/api/works', { cookie: userCookie })).data.works.length, 1)
  assert.equal((await call(runtime.api, `/api/works/${work.data.work.id}`, { cookie: otherCookie })).response.status, 404)
  const order = await call(runtime.api, '/api/orders', { method: 'POST', cookie: userCookie, body: { amountYuan: 10 } })
  assert.equal(order.data.order.credits, 12)
  assert.equal(order.data.order.status, 'pending')
  assert.equal((await call(runtime.api, `/api/orders/${order.data.order.id}`, { cookie: otherCookie })).response.status, 404)
})

test('protects administrator provider routes and redacts secrets', async () => {
  const runtime = createAppRuntime({ providerTester: async () => ({ ok: true, httpStatus: 200 }) })
  const publicAdminRegistration = await call(runtime.api, '/api/auth/register', { method: 'POST', body: { email: 'admin@example.com', password: 'correct-horse' } })
  assert.equal(publicAdminRegistration.response.status, 409)
  const provisioned = await runtime.provisionAdmin({ password: 'correct-horse' })
  assert.equal(provisioned.ok, true)
  assert.equal(provisioned.user.email, 'admin@example.com')
  const adminCookie = await login(runtime.api, 'admin@example.com')
  const userCookie = await registerAndLogin(runtime.api, 'user@example.com')
  const secret = 'local-test-provider-secret'
  const created = await call(runtime.api, '/api/admin/providers', { method: 'POST', cookie: adminCookie, body: { name: 'render-api', endpoint: 'https://provider.invalid', model: 'interior-v1', apiKey: secret } })
  assert.equal(created.response.status, 201)
  assert.equal(JSON.stringify(created.data).includes(secret), false)
  assert.equal(created.data.provider.apiKeyMasked, '********')
  assert.equal((await call(runtime.api, '/api/admin/providers', { cookie: userCookie })).response.status, 403)
  assert.equal((await call(runtime.api, '/api/admin/providers')).response.status, 401)
  const enabled = await call(runtime.api, `/api/admin/providers/${created.data.provider.id}/enabled`, { method: 'POST', cookie: adminCookie, body: { enabled: true } })
  assert.equal(enabled.data.provider.enabled, true)
  const audit = await call(runtime.api, `/api/admin/providers/${created.data.provider.id}/audit`, { cookie: adminCookie })
  assert.equal(JSON.stringify(audit.data).includes(secret), false)
})

test('lets administrators issue limited redemption codes and users redeem them once', async () => {
  const runtime = createAppRuntime()
  assert.equal((await runtime.provisionAdmin({ password: 'correct-horse' })).ok, true)
  const adminCookie = await login(runtime.api, 'admin@example.com')
  const userCookie = await registerAndLogin(runtime.api, 'redeem@example.com')
  const otherCookie = await registerAndLogin(runtime.api, 'redeem-other@example.com')
  const created = await call(runtime.api, '/api/admin/redemption-codes', { method: 'POST', cookie: adminCookie, body: { credits: 4, maxRedemptions: 1 } })
  assert.equal(created.response.status, 201)
  assert.match(created.data.code, /^ROOM-/u)
  const list = await call(runtime.api, '/api/admin/redemption-codes', { cookie: adminCookie })
  assert.equal(JSON.stringify(list.data).includes(created.data.code), false)
  assert.equal((await call(runtime.api, '/api/admin/redemption-codes', { cookie: userCookie })).response.status, 403)
  const redeemed = await call(runtime.api, '/api/redemption-codes/redeem', { method: 'POST', cookie: userCookie, body: { code: created.data.code } })
  assert.equal(redeemed.data.creditsAdded, 4)
  assert.equal(redeemed.data.available, 7)
  assert.equal((await call(runtime.api, '/api/redemption-codes/redeem', { method: 'POST', cookie: userCookie, body: { code: created.data.code } })).response.status, 409)
  assert.equal((await call(runtime.api, '/api/redemption-codes/redeem', { method: 'POST', cookie: otherCookie, body: { code: created.data.code } })).data.code, 'REDEMPTION_CODE_EXHAUSTED')
})

test('rejects a failed Provider test without saving configuration or consuming user state', async () => {
  const runtime = createAppRuntime({ providerTester: async () => ({ ok: false, code: 'PROVIDER_TEST_FAILED', stage: 'response', httpStatus: 401 }) })
  assert.equal((await runtime.provisionAdmin({ password: 'correct-horse' })).ok, true)
  const adminCookie = await login(runtime.api, 'admin@example.com')
  const beforeTasks = runtime.generationService.store.tasks.size
  const failed = await call(runtime.api, '/api/admin/providers', { method: 'POST', cookie: adminCookie, body: { name: 'rejected-provider', endpoint: 'https://provider.invalid/v1/images/generations', model: 'image-v1', apiKey: 'not-returned' } })
  assert.equal(failed.response.status, 502)
  assert.equal(failed.data.code, 'PROVIDER_TEST_FAILED')
  assert.equal(failed.data.stage, 'response')
  assert.equal(failed.data.httpStatus, 401)
  assert.match(failed.data.traceId, /^provider_test_/u)
  assert.equal(JSON.stringify(failed.data).includes('not-returned'), false)
  assert.equal((await call(runtime.api, '/api/admin/providers', { cookie: adminCookie })).data.providers.length, 0)
  assert.equal(runtime.generationService.store.tasks.size, beforeTasks)
})

test('rejects unsupported, malformed and oversized requests without internal details', async () => {
  const runtime = createAppRuntime()
  const invalidJsonPrefix = await call(runtime.api, '/api/auth/register', { method: 'POST', body: { email: 'prefix@example.com', password: 'correct-horse' }, contentType: 'application/json-evil' })
  assert.equal(invalidJsonPrefix.response.status, 415)
  assert.equal(runtime.authService.store.users.has('prefix@example.com'), false)
  assert.ok(appApiConstants.DEFAULT_MAX_JSON_BYTES > Math.ceil((10 * 1024 * 1024 * 4) / 3) + 1024)
  runtime.api.maxJsonBytes = 32
  const unsupported = await call(runtime.api, '/api/auth/register', { method: 'POST', body: '{}', contentType: 'text/plain' })
  assert.equal(unsupported.response.status, 415)
  const malformed = await call(runtime.api, '/api/auth/register', { method: 'POST', body: '{' })
  assert.deepEqual(malformed.data, { ok: false, code: 'INVALID_JSON' })
  const oversized = await call(runtime.api, '/api/auth/register', { method: 'POST', body: { email: 'long@example.com', password: 'x'.repeat(100) } })
  assert.equal(oversized.response.status, 413)
  assert.equal(JSON.stringify(oversized.data).includes('stack'), false)
})
