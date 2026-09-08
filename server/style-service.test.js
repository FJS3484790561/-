import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AuthService } from './auth-service.js'
import { StyleService } from './style-service.js'
import { createSqliteStores } from './persistence/sqlite-stores.js'

const image = { type: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]) }

async function memoryFixture() {
  const authService = new AuthService()
  await authService.provisionUser({ email: 'style-a@example.com', password: 'correct-horse' })
  await authService.provisionUser({ email: 'style-b@example.com', password: 'correct-horse' })
  return {
    authService,
    user: await authService.login({ email: 'style-a@example.com', password: 'correct-horse' }),
    other: await authService.login({ email: 'style-b@example.com', password: 'correct-horse' }),
  }
}

test('custom styles are isolated per user and reject unauthenticated access', async () => {
  const fixture = await memoryFixture()
  const service = new StyleService({ authService: fixture.authService })
  assert.deepEqual(service.list({ sessionToken: 'missing' }), { ok: false, code: 'UNAUTHORIZED' })
  const created = service.create({ sessionToken: fixture.user.sessionToken, name: '我的暖木风', prompt: '暖白、浅木、亚麻', image })
  assert.equal(created.ok, true)
  assert.equal(created.style.image.size, image.data.length)
  assert.equal(created.style.image.dataBase64, image.data.toString('base64'))
  assert.equal(service.list({ sessionToken: fixture.user.sessionToken }).styles.length, 1)
  assert.equal(service.list({ sessionToken: fixture.other.sessionToken }).styles.length, 0)
})

test('custom styles survive a SQLite close and reopen', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'interior-style-service-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const filename = join(root, 'app.sqlite')

  let stores = createSqliteStores({ filename })
  let authService = new AuthService({ store: stores.auth })
  await authService.provisionUser({ email: 'persist-style@example.com', password: 'correct-horse' })
  const login = await authService.login({ email: 'persist-style@example.com', password: 'correct-horse' })
  const service = new StyleService({ authService, store: stores.styles })
  assert.equal(service.create({ sessionToken: login.sessionToken, name: '持久风格', prompt: '自然木色', image }).ok, true)
  stores.close()

  stores = createSqliteStores({ filename })
  authService = new AuthService({ store: stores.auth })
  const reopenedLogin = await authService.login({ email: 'persist-style@example.com', password: 'correct-horse' })
  const reopened = new StyleService({ authService, store: stores.styles })
  assert.deepEqual(reopened.list({ sessionToken: reopenedLogin.sessionToken }).styles.map((style) => style.name), ['持久风格'])
  assert.equal(reopened.list({ sessionToken: reopenedLogin.sessionToken }).styles[0].image.size, image.data.length)
  stores.close()
})
