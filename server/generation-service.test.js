import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthService, MemoryAuthStore } from './auth-service.js'
import { GenerationService, MemoryGenerationStore, ProviderRegistry } from './generation-service.js'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const params = { room: '客厅', theme: '现代简约', scale: '均衡', preferences: { layout: true } }

async function fixture({ provider, providerTimeoutMs = 100 } = {}) {
  const authService = new AuthService({ store: new MemoryAuthStore() })
  await authService.register({ email: 'user@example.com', password: 'correct-horse' })
  const login = await authService.login({ email: 'user@example.com', password: 'correct-horse' })
  const providers = new ProviderRegistry(provider ? { default: provider } : {})
  return { authService, token: login.sessionToken, service: new GenerationService({ authService, store: new MemoryGenerationStore(), providers, providerTimeoutMs }) }
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
  await fixtureData.authService.register({ email: 'other@example.com', password: 'correct-horse' })
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
