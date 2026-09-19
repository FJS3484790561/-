import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthService, MemoryAuthStore } from './auth-service.js'
import { GenerationService, MemoryGenerationStore, ProviderRegistry } from './generation-service.js'
import { CreditLedgerService, MemoryCreditStore } from './credit-ledger.js'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const params = { room: '客厅', theme: '现代简约', scale: '均衡', preferences: { layout: true } }

async function fixture({ provider, providerTimeoutMs = 100, objectStorage = null, fetchImpl, lookupImpl } = {}) {
  const authService = new AuthService({ store: new MemoryAuthStore() })
  await authService.provisionUser({ email: 'user@example.com', password: 'correct-horse' })
  const login = await authService.login({ email: 'user@example.com', password: 'correct-horse' })
  const providers = new ProviderRegistry(provider ? { default: provider } : {})
  return { authService, token: login.sessionToken, service: new GenerationService({ authService, store: new MemoryGenerationStore(), providers, providerTimeoutMs, objectStorage, fetchImpl, lookupImpl }) }
}

test('creates an async generation and returns one safe result', async () => {
  const fixtureData = await fixture({ provider: { generate: async () => ({ effectImage: { url: '/generated/result.jpg', mimeType: 'image/jpeg' } }) } })
  const created = await fixtureData.service.createGeneration({ sessionToken: fixtureData.token, image: { name: 'room.jpg', type: 'image/jpeg', data: jpeg }, params })
  assert.equal(created.ok, true)
  assert.equal(created.task.status, 'queued')
  const result = await fixtureData.service.waitForGeneration(created.task.id)
  assert.equal(result.status, 'succeeded')
  assert.deepEqual(result.result.original, { name: 'room.jpg', type: 'image/jpeg', size: jpeg.length })
  assert.deepEqual(result.result.effectImage, { url: '/generated/result.jpg', mimeType: 'image/jpeg' })
  assert.ok(Number.isFinite(result.timings.providerMs))
  assert.ok(Number.isFinite(result.timings.nonProviderMs))
  assert.ok(Number.isFinite(result.timings.serverTotalMs))
})

test('rejects invalid images and never calls the provider', async () => {
  let calls = 0
  const fixtureData = await fixture({ provider: { generate: async () => { calls += 1; return { effectImage: { url: 'secret' } } } } })
  const response = await fixtureData.service.createGeneration({ sessionToken: fixtureData.token, image: { name: 'room.gif', type: 'image/gif', data: Buffer.from('not-an-image') }, params })
  assert.deepEqual(response, { ok: false, code: 'VALIDATION_ERROR', fields: { image: '仅支持 JPEG 或 PNG 图片。' } })
  assert.equal(calls, 0)
})

test('requires an authenticated session and isolates task ownership', async () => {
  const fixtureData = await fixture({ provider: { generate: async () => ({ effectImage: { url: '/result' } }) } })
  assert.deepEqual(await fixtureData.service.createGeneration({ sessionToken: 'invalid', image: { type: 'image/jpeg', data: jpeg }, params }), { ok: false, code: 'UNAUTHORIZED' })
  assert.deepEqual(await fixtureData.service.createGeneration({ image: { type: 'image/jpeg', data: jpeg }, params }), { ok: false, code: 'UNAUTHORIZED' })
  await fixtureData.authService.provisionUser({ email: 'other@example.com', password: 'correct-horse' })
  const otherLogin = await fixtureData.authService.login({ email: 'other@example.com', password: 'correct-horse' })
  const created = await fixtureData.service.createGeneration({ sessionToken: fixtureData.token, image: { type: 'image/jpeg', data: jpeg }, params })
  assert.deepEqual(fixtureData.service.getGeneration({ sessionToken: otherLogin.sessionToken, taskId: created.task.id }), { ok: false, code: 'NOT_FOUND' })
})

test('maps provider errors and timeouts without exposing provider details', async () => {
  const failed = await fixture({ provider: { generate: async () => { throw new Error('upstream token=secret') } } })
  const failedTask = await failed.service.createGeneration({ sessionToken: failed.token, image: { type: 'image/jpeg', data: jpeg }, params })
  assert.deepEqual((await failed.service.waitForGeneration(failedTask.task.id)).error, { code: 'PROVIDER_UNAVAILABLE', message: '暂时无法生成设计，请稍后重试。' })

  const timedOut = await fixture({ provider: { generate: async () => new Promise(() => {}) }, providerTimeoutMs: 1 })
  const timeoutTask = await timedOut.service.createGeneration({ sessionToken: timedOut.token, image: { type: 'image/jpeg', data: jpeg }, params })
  assert.deepEqual((await timedOut.service.waitForGeneration(timeoutTask.task.id)).error, { code: 'GENERATION_TIMEOUT', message: '生成时间较长，请稍后重试。' })
})

test('reserves one credit before generation and releases it when generation fails', async () => {
  const fixtureData = await fixture({ provider: { generate: async () => { throw new Error('upstream failed') } } })
  const ledger = new CreditLedgerService({ authService: fixtureData.authService, store: new MemoryCreditStore() })
  ledger.initializeUser({ sessionToken: fixtureData.token })
  const service = new GenerationService({ authService: fixtureData.authService, store: new MemoryGenerationStore(), providers: new ProviderRegistry({ default: { generate: async () => { throw new Error('upstream failed') } } }), creditLedger: ledger })
  const task = await service.createGeneration({ sessionToken: fixtureData.token, image: { type: 'image/jpeg', data: jpeg }, params })
  assert.equal(task.ok, true)
  assert.equal((await service.waitForGeneration(task.task.id)).status, 'failed')
  assert.equal(ledger.getBalance({ sessionToken: fixtureData.token }).available, 3)
})

test('settles one credit after a successful generation', async () => {
  const fixtureData = await fixture()
  const ledger = new CreditLedgerService({ authService: fixtureData.authService, store: new MemoryCreditStore() })
  let calls = 0
  const service = new GenerationService({ authService: fixtureData.authService, store: new MemoryGenerationStore(), providers: new ProviderRegistry({ default: { generate: async () => { calls += 1; return { effectImage: { url: '/generated/result.jpg' } } } } }), creditLedger: ledger })
  const task = await service.createGeneration({ sessionToken: fixtureData.token, image: { type: 'image/jpeg', data: jpeg }, params })
  const result = await service.waitForGeneration(task.task.id)
  assert.equal(result.status, 'succeeded')
  assert.equal(calls, 1)
  assert.equal(ledger.getBalance({ sessionToken: fixtureData.token }).available, 2)
})

test('does not call the provider when all credits are exhausted', async () => {
  const fixtureData = await fixture()
  const ledger = new CreditLedgerService({ authService: fixtureData.authService, store: new MemoryCreditStore() })
  const userId = fixtureData.authService.getSession(fixtureData.token).id
  for (let index = 0; index < 3; index += 1) {
    const reservation = ledger.reserveForUser({ userId, operationId: `used-${index}` })
    ledger.settleForUser({ userId, reservationId: reservation.reservation.id })
  }
  let calls = 0
  const service = new GenerationService({ authService: fixtureData.authService, store: new MemoryGenerationStore(), providers: new ProviderRegistry({ default: { generate: async () => { calls += 1; return { effectImage: { url: '/should-not-run' } } } } }), creditLedger: ledger })
  assert.deepEqual(await service.createGeneration({ sessionToken: fixtureData.token, image: { type: 'image/jpeg', data: jpeg }, params }), { ok: false, code: 'INSUFFICIENT_CREDITS' })
  assert.equal(calls, 0)
})

test('downloads a remote provider result into protected object storage', async () => {
  const stored = []
  const objectStorage = {
    async put(record) {
      stored.push(record)
      return { key: record.key, mimeType: record.mimeType }
    },
  }
  const fixtureData = await fixture({
    provider: { generate: async () => ({ effectImage: { url: 'https://provider.example.test/result.jpg', mimeType: 'image/jpeg' } }) },
    objectStorage,
    fetchImpl: async () => new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.length) } }),
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
  })
  const created = await fixtureData.service.createGeneration({ sessionToken: fixtureData.token, image: { type: 'image/jpeg', data: jpeg }, params })
  const result = await fixtureData.service.waitForGeneration(created.task.id)
  assert.equal(result.status, 'succeeded')
  assert.equal(stored.length, 2)
  assert.match(result.result.effectImage.url, /^\/api\/objects\//u)
  assert.equal(result.result.effectImage.url.includes('provider.example.test'), false)
  assert.deepEqual(stored[1].body, jpeg)
  assert.equal(Number.isFinite(result.timings.resultDownloadMs), true)
  assert.equal(Number.isFinite(result.timings.resultUploadMs), true)
  assert.ok(result.timings.resultStoreMs >= result.timings.resultDownloadMs)
  assert.ok(result.timings.resultStoreMs >= result.timings.resultUploadMs)
})

test('accepts an enabled dynamic theme and records the generated prompt for administrators only', async () => {
  const store = new MemoryGenerationStore()
  const authService = new AuthService({ store: new MemoryAuthStore() })
  await authService.provisionUser({ email: 'user@example.com', password: 'correct-horse' })
  await authService.provisionUser({ email: 'admin@example.com', password: 'correct-horse' })
  const user = await authService.login({ email: 'user@example.com', password: 'correct-horse' })
  const admin = await authService.login({ email: 'admin@example.com', password: 'correct-horse' })
  const service = new GenerationService({
    authService,
    store,
    providers: new ProviderRegistry({ default: { generate: async () => ({ effectImage: { url: '/result.jpg' }, generationPrompt: '完整图生图提示词' }) } }),
    themeValidator: (theme) => theme === '暖木客厅',
    isAdmin: (account) => account.email === 'admin@example.com',
  })
  const created = await service.createGeneration({ sessionToken: user.sessionToken, image: { type: 'image/jpeg', data: jpeg }, params: { ...params, theme: '暖木客厅' } })
  assert.equal(created.ok, true)
  await service.waitForGeneration(created.task.id)
  assert.deepEqual(service.listPromptDebug({ sessionToken: user.sessionToken }), { ok: false, code: 'FORBIDDEN' })
  const debug = service.listPromptDebug({ sessionToken: admin.sessionToken })
  assert.equal(debug.ok, true)
  assert.equal(debug.promptDebugs[0].prompt, '完整图生图提示词')
})

test('rejects private provider result addresses before fetching', async () => {
  let fetches = 0
  const objectStorage = { async put(record) { return { key: record.key, mimeType: record.mimeType } } }
  const fixtureData = await fixture({
    provider: { generate: async () => ({ effectImage: { url: 'https://127.0.0.1/private.jpg', mimeType: 'image/jpeg' } }) },
    objectStorage,
    fetchImpl: async () => { fetches += 1; return new Response(jpeg, { status: 200 }) },
  })
  const created = await fixtureData.service.createGeneration({ sessionToken: fixtureData.token, image: { type: 'image/jpeg', data: jpeg }, params })
  const result = await fixtureData.service.waitForGeneration(created.task.id)
  assert.equal(result.status, 'failed')
  assert.equal(result.error.code, 'RESULT_DOWNLOAD_FAILED')
  assert.equal(fetches, 0)
})

test('rejects IPv4-mapped private provider result addresses before fetching', async () => {
  let fetches = 0
  const objectStorage = { async put(record) { return { key: record.key, mimeType: record.mimeType } } }
  const fixtureData = await fixture({
    provider: { generate: async () => ({ effectImage: { url: 'https://[::ffff:172.16.0.1]/private.jpg', mimeType: 'image/jpeg' } }) },
    objectStorage,
    fetchImpl: async () => { fetches += 1; return new Response(jpeg, { status: 200 }) },
    lookupImpl: async () => [{ address: '::ffff:172.16.0.1', family: 6 }],
  })
  const created = await fixtureData.service.createGeneration({ sessionToken: fixtureData.token, image: { type: 'image/jpeg', data: jpeg }, params })
  const result = await fixtureData.service.waitForGeneration(created.task.id)
  assert.equal(result.status, 'failed')
  assert.equal(result.error.code, 'RESULT_DOWNLOAD_FAILED')
  assert.equal(fetches, 0)
})
