import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthService, MemoryAuthStore } from './auth-service.js'

function createFixture() {
  let now = 1_700_000_000_000
  const sent = []
  const service = new AuthService({
    store: new MemoryAuthStore(() => now),
    clock: () => now,
    mailer: { sendPasswordReset: async (message) => sent.push(message), sendRegistrationCode: async (message) => sent.push(message) },
  })
  return { service, sent, advance: (ms) => { now += ms } }
}

test('registers a user and rejects duplicate email', async () => {
  const { service, sent } = createFixture()
  await service.requestRegistrationCode('User@Example.com')
  assert.equal((await service.register({ email: 'User@Example.com', password: 'correct-horse', verificationCode: sent[0].code })).ok, true)
  assert.deepEqual(await service.register({ email: 'user@example.com', password: 'correct-horse' }), { ok: false, code: 'EMAIL_ALREADY_REGISTERED' })
})

test('login creates a session that survives lookup and logout', async () => {
  const { service } = createFixture()
  await service.provisionUser({ email: 'user@example.com', password: 'correct-horse' })
  const login = await service.login({ email: 'user@example.com', password: 'correct-horse' })
  assert.equal(login.ok, true)
  assert.equal(service.getSession(login.sessionToken).email, 'user@example.com')
  service.logout(login.sessionToken)
  assert.equal(service.getSession(login.sessionToken), null)
})

test('does not reveal credential validity and rejects wrong passwords', async () => {
  const { service } = createFixture()
  await service.provisionUser({ email: 'user@example.com', password: 'correct-horse' })
  assert.deepEqual(await service.login({ email: 'user@example.com', password: 'wrong-one' }), { ok: false, code: 'INVALID_CREDENTIALS' })
  assert.deepEqual(await service.login({ email: 'missing@example.com', password: 'wrong-one' }), { ok: false, code: 'INVALID_CREDENTIALS' })
})

test('reset links are one-time and expire', async () => {
  const { service, sent, advance } = createFixture()
  await service.provisionUser({ email: 'user@example.com', password: 'correct-horse' })
  await service.requestPasswordReset('user@example.com')
  assert.equal(sent.length, 1)
  assert.deepEqual(await service.resetPassword({ token: sent[0].token, password: 'new-password' }), { ok: true })
  assert.deepEqual(await service.resetPassword({ token: sent[0].token, password: 'another-pass' }), { ok: false, code: 'INVALID_OR_EXPIRED_RESET' })
  await service.requestPasswordReset('user@example.com')
  advance(30 * 60 * 1000 + 1)
  assert.deepEqual(await service.resetPassword({ token: sent[1].token, password: 'new-password' }), { ok: false, code: 'INVALID_OR_EXPIRED_RESET' })
})

test('password reset request has the same response for unknown emails', async () => {
  const { service, sent } = createFixture()
  assert.deepEqual(await service.requestPasswordReset('missing@example.com'), { ok: true })
  assert.equal(sent.length, 0)
})
