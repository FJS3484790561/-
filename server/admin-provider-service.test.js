import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthService, MemoryAuthStore } from './auth-service.js'
import { AdminProviderService, MemoryAdminProviderStore } from './admin-provider-service.js'

async function fixture() {
  const authService = new AuthService({ store: new MemoryAuthStore() })
  const admin = await authService.register({ email: 'admin@example.com', password: 'correct-horse' })
  const user = await authService.register({ email: 'user@example.com', password: 'correct-horse' })
  const adminLogin = await authService.login({ email: 'admin@example.com', password: 'correct-horse' })
  const userLogin = await authService.login({ email: 'user@example.com', password: 'correct-horse' })
  const service = new AdminProviderService({
    authService,
    store: new MemoryAdminProviderStore(),
    encryptionKey: Buffer.alloc(32, 7),
    isAdmin: (account) => account.id === admin.user.id,
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
  const created = data.service.create({ sessionToken: data.adminToken, name: 'render-api', endpoint: 'https://provider.invalid/v1', model: 'interior-v1', apiKey: 'secret-key-value' })
  assert.equal(created.ok, true)
  assert.equal(created.provider.apiKeyMasked, '********')
  assert.equal(created.provider.apiKeyConfigured, true)
  assert.equal(JSON.stringify(created).includes('secret-key-value'), false)
  const providerId = created.provider.id
  assert.equal(data.service.get({ sessionToken: data.adminToken, providerId }).provider.apiKeyMasked, '********')
  assert.equal(data.service.update({ sessionToken: data.adminToken, providerId, model: 'interior-v2' }).provider.model, 'interior-v2')
  assert.equal(data.service.setEnabled({ sessionToken: data.adminToken, providerId, enabled: true }).provider.enabled, true)
  assert.deepEqual(data.service.readSecretForProvider({ providerId }), { ok: true, apiKey: 'secret-key-value' })
  assert.equal(data.service.setEnabled({ sessionToken: data.adminToken, providerId, enabled: false }).provider.enabled, false)
  assert.deepEqual(data.service.readSecretForProvider({ providerId }), { ok: false, code: 'PROVIDER_NOT_AVAILABLE' })
})

test('stores encrypted secrets and writes redacted audit records', async () => {
  const data = await fixture()
  const created = data.service.create({ sessionToken: data.adminToken, name: 'safe-provider', endpoint: 'https://provider.invalid', model: 'model-a', apiKey: 'do-not-log-me' })
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
  const created = data.service.create({ sessionToken: data.adminToken, name: 'scoped-provider', endpoint: 'https://provider.invalid', model: 'model-a', apiKey: 'secret' })
  const scopedService = new AdminProviderService({
    authService: data.authService,
    store: data.service.store,
    encryptionKey: Buffer.alloc(32, 7),
    isAdmin: () => true,
    canManage: (_userId, name) => name === 'other-provider',
  })
  assert.deepEqual(scopedService.get({ sessionToken: data.adminToken, providerId: created.provider.id }), { ok: false, code: 'NOT_FOUND' })
  assert.equal(data.service.update({ sessionToken: data.adminToken, providerId: created.provider.id, endpoint: '' }).code, 'VALIDATION_ERROR')
  assert.equal(data.service.setEnabled({ sessionToken: data.userToken, providerId: created.provider.id, enabled: true }).code, 'FORBIDDEN')
})
