import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthService, MemoryAuthStore } from './auth-service.js'
import { AdminProviderService, MemoryAdminProviderStore } from './admin-provider-service.js'

async function fixture({ testProvider = async () => ({ ok: true, httpStatus: 200 }), logger = { info() {}, error() {} } } = {}) {
  const authService = new AuthService({ store: new MemoryAuthStore() })
  const admin = await authService.provisionUser({ email: 'admin@example.com', password: 'correct-horse' })
  const user = await authService.provisionUser({ email: 'user@example.com', password: 'correct-horse' })
  const adminLogin = await authService.login({ email: 'admin@example.com', password: 'correct-horse' })
  const userLogin = await authService.login({ email: 'user@example.com', password: 'correct-horse' })
  const service = new AdminProviderService({
    authService,
    store: new MemoryAdminProviderStore(),
    encryptionKey: Buffer.alloc(32, 7),
    isAdmin: (account) => account.id === admin.user.id,
    testProvider,
    logger,
  })
  return { authService, service, adminToken: adminLogin.sessionToken, userToken: userLogin.sessionToken, adminId: admin.user.id, userId: user.user.id }
}

test('requires an authenticated administrator and keeps access errors safe', async () => {
  const data = await fixture()
  assert.deepEqual(data.service.list({}), { ok: false, code: 'UNAUTHORIZED' })
  assert.deepEqual(data.service.list({ sessionToken: data.userToken }), { ok: false, code: 'FORBIDDEN' })
})

test('supports provider lifecycle and never returns the API key', async () => {
  const data = await fixture()
  const created = await data.service.create({ sessionToken: data.adminToken, name: 'render-api', endpoint: 'https://provider.invalid/v1', model: 'interior-v1', apiKey: 'secret-key-value' })
  assert.equal(created.ok, true)
  assert.equal(created.provider.apiKeyMasked, '********')
  assert.equal(created.provider.apiKeyConfigured, true)
  assert.equal(JSON.stringify(created).includes('secret-key-value'), false)
  const providerId = created.provider.id
  assert.equal(data.service.get({ sessionToken: data.adminToken, providerId }).provider.apiKeyMasked, '********')
  assert.equal((await data.service.update({ sessionToken: data.adminToken, providerId, model: 'interior-v2' })).provider.model, 'interior-v2')
  assert.equal(data.service.setEnabled({ sessionToken: data.adminToken, providerId, enabled: true }).provider.enabled, true)
  assert.deepEqual(data.service.readSecretForProvider({ providerId }), { ok: true, apiKey: 'secret-key-value' })
  assert.equal(data.service.setEnabled({ sessionToken: data.adminToken, providerId, enabled: false }).provider.enabled, false)
  assert.deepEqual(data.service.readSecretForProvider({ providerId }), { ok: false, code: 'PROVIDER_NOT_AVAILABLE' })
})

test('stores encrypted secrets and writes redacted audit records', async () => {
  const data = await fixture()
  const created = await data.service.create({ sessionToken: data.adminToken, name: 'safe-provider', endpoint: 'https://provider.invalid', model: 'model-a', apiKey: 'do-not-log-me' })
  const raw = data.service.store.configs.get(created.provider.id)
  assert.equal(Object.hasOwn(raw, 'apiKey'), false)
  assert.equal(raw.encryptedApiKey.includes('do-not-log-me'), false)
  data.service.setEnabled({ sessionToken: data.adminToken, providerId: created.provider.id, enabled: true })
  const audit = data.service.listAudit({ sessionToken: data.adminToken, providerId: created.provider.id })
  assert.equal(audit.audit.length, 2)
  assert.equal(JSON.stringify(audit).includes('do-not-log-me'), false)
  assert.deepEqual(audit.audit.map((entry) => entry.action), ['created', 'enabled'])
})

test('isolates provider management scope and rejects invalid changes', async () => {
  const data = await fixture()
  const created = await data.service.create({ sessionToken: data.adminToken, name: 'scoped-provider', endpoint: 'https://provider.invalid', model: 'model-a', apiKey: 'secret' })
  const scopedService = new AdminProviderService({
    authService: data.authService,
    store: data.service.store,
    encryptionKey: Buffer.alloc(32, 7),
    isAdmin: () => true,
    canManage: (_userId, name) => name === 'other-provider',
  })
  assert.deepEqual(scopedService.get({ sessionToken: data.adminToken, providerId: created.provider.id }), { ok: false, code: 'NOT_FOUND' })
  assert.equal((await data.service.update({ sessionToken: data.adminToken, providerId: created.provider.id, endpoint: '' })).code, 'VALIDATION_ERROR')
  assert.equal(data.service.setEnabled({ sessionToken: data.userToken, providerId: created.provider.id, enabled: true }).code, 'FORBIDDEN')
})

test('tests a provider before saving and preserves the previous configuration on failure', async () => {
  const calls = []
  const data = await fixture({ testProvider: async (config) => { calls.push(config); return calls.length === 1 ? { ok: true, httpStatus: 200 } : { ok: false, code: 'PROVIDER_TEST_FAILED', stage: 'response', httpStatus: 401 } } })
  const created = await data.service.create({ sessionToken: data.adminToken, name: 'guarded', endpoint: 'https://provider.invalid/v1/images/generations', model: 'image-v1', apiKey: 'original-secret' })
  assert.equal(created.ok, true)
  const failed = await data.service.update({ sessionToken: data.adminToken, providerId: created.provider.id, endpoint: 'https://provider.invalid/broken', model: 'image-v2', apiKey: 'replacement-secret' })
  assert.equal(failed.ok, false)
  assert.equal(failed.httpStatus, 401)
  const unchanged = data.service.get({ sessionToken: data.adminToken, providerId: created.provider.id }).provider
  assert.equal(unchanged.endpoint, 'https://provider.invalid/v1/images/generations')
  assert.equal(unchanged.model, 'image-v1')
  assert.deepEqual(data.service.listAudit({ sessionToken: data.adminToken, providerId: created.provider.id }).audit.map((entry) => entry.action), ['created'])
  assert.equal(calls[1].apiKey, 'replacement-secret')
})

test('returns staged redacted diagnostics without exposing the API key', async () => {
  const logs = []
  const logger = { info: (...values) => logs.push(values), error: (...values) => logs.push(values) }
  const data = await fixture({ testProvider: async () => ({ ok: false, code: 'INVALID_PROVIDER_RESPONSE', stage: 'validation', httpStatus: 200 }), logger })
  const result = await data.service.create({ sessionToken: data.adminToken, name: 'diagnostic', endpoint: 'https://provider.invalid', model: 'image-v1', apiKey: 'never-log-this-secret' })
  assert.equal(result.stage, 'validation')
  assert.equal(result.httpStatus, 200)
  assert.match(result.traceId, /^provider_test_/u)
  assert.equal(JSON.stringify({ result, logs }).includes('never-log-this-secret'), false)
  assert.equal(data.service.list({ sessionToken: data.adminToken }).providers.length, 0)
})

test('passes safe protocol, timing and upstream diagnostics to the admin console', async () => {
  const logs = []
  const logger = { info: (...values) => logs.push(values), error: (...values) => logs.push(values) }
  const data = await fixture({ testProvider: async () => ({ ok: false, code: 'PROVIDER_TEST_FAILED', stage: 'response', httpStatus: 400, protocol: 'json-reference-image', elapsedMs: 321, upstreamCode: 'invalid_image', upstreamMessage: 'image is too small' }), logger })
  const result = await data.service.create({ sessionToken: data.adminToken, name: 'diagnostic-json', endpoint: 'https://duoyuanx.com/v1/images/generations', model: 'gpt-image-2', apiKey: 'never-log-upstream-secret' })
  assert.equal(result.protocol, 'json-reference-image')
  assert.equal(result.elapsedMs, 321)
  assert.equal(result.upstreamCode, 'invalid_image')
  assert.equal(result.upstreamMessage, 'image is too small')
  assert.equal(JSON.stringify({ result, logs }).includes('never-log-upstream-secret'), false)
})
