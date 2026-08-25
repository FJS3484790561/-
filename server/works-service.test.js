import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthService, MemoryAuthStore } from './auth-service.js'
import { MemoryWorksStore, WorksService } from './works-service.js'

async function fixture() {
  const authService = new AuthService({ store: new MemoryAuthStore() })
  await authService.register({ email: 'user@example.com', password: 'correct-horse' })
  await authService.register({ email: 'other@example.com', password: 'correct-horse' })
  const user = await authService.login({ email: 'user@example.com', password: 'correct-horse' })
  const other = await authService.login({ email: 'other@example.com', password: 'correct-horse' })
  return { authService, user, other, store: new MemoryWorksStore() }
}

test('persists works through a shared store and isolates users', async () => {
  const fixtureData = await fixture()
  const firstDevice = new WorksService({ authService: fixtureData.authService, store: fixtureData.store })
  const secondDevice = new WorksService({ authService: fixtureData.authService, store: fixtureData.store })
  const created = firstDevice.create({ sessionToken: fixtureData.user.sessionToken, generationId: 'generation-1', original: { url: '/uploads/room.jpg', mimeType: 'image/jpeg' }, effectImage: { url: '/generated/result.jpg', mimeType: 'image/jpeg' }, params: { room: '客厅', theme: '现代简约', preferences: { layout: true } } })
  assert.equal(created.ok, true)
  assert.equal(secondDevice.list({ sessionToken: fixtureData.user.sessionToken }).works.length, 1)
  assert.equal(secondDevice.get({ sessionToken: fixtureData.user.sessionToken, workId: created.work.id }).work.generationId, 'generation-1')
  assert.deepEqual(secondDevice.get({ sessionToken: fixtureData.other.sessionToken, workId: created.work.id }), { ok: false, code: 'NOT_FOUND' })
})

test('rejects incomplete work records', async () => {
  const fixtureData = await fixture()
  const works = new WorksService({ authService: fixtureData.authService, store: fixtureData.store })
  assert.deepEqual(works.create({ sessionToken: fixtureData.user.sessionToken, generationId: 'generation-1', params: {} }), { ok: false, code: 'INVALID_WORK' })
})
