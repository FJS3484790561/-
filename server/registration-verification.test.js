import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from './auth-service.js'
import { createSqliteStores } from './persistence/sqlite-stores.js'
import { createAppRuntime } from './app-runtime.js'
import { createMailer } from './mailer.js'

function fixture(options = {}) {
  let now = 1000000
  const messages = []
  const service = new AuthService({ clock: () => now, mailer: { sendRegistrationCode: async (message) => messages.push(message) }, ...options })
  return { service, messages, advance: (ms) => { now += ms }, register: (code, email = 'new@example.com') => service.register({ email, password: 'test-password', verificationCode: code }) }
}

test('registration requires a code, binds it to email, consumes it once and verifies the user', async () => {
  const f = fixture()
  assert.equal((await f.register()).code, 'INVALID_VERIFICATION_CODE')
  const sent = await f.service.requestRegistrationCode('New@Example.com')
  assert.deepEqual(sent, { ok: true, retryAfterSeconds: 60 })
  const code = f.messages[0].code
  assert.equal(JSON.stringify([...f.service.store.registrationChallenges]).includes(code), false)
  assert.equal((await f.register(code, 'other@example.com')).ok, false)
  const outcomes = await Promise.all([f.register(code), f.register(code)])
  assert.equal(outcomes.filter((result) => result.ok).length, 1)
  assert.equal(f.service.store.users.size, 1)
  assert.equal(typeof f.service.store.users.get('new@example.com').emailVerifiedAt, 'number')
  assert.equal((await f.register(code)).ok, false)
})

test('verification expires, limits guesses and invalidates previous code on resend', async () => {
  const f = fixture()
  await f.service.requestRegistrationCode('new@example.com')
  const code = f.messages[0].code
  assert.equal((await f.service.requestRegistrationCode('NEW@example.com')).code, 'CODE_RATE_LIMITED')
  for (let i = 0; i < 5; i++) assert.equal((await f.register('invalid')).ok, false)
  assert.equal((await f.register(code)).ok, false)
  f.advance(60000)
  await f.service.requestRegistrationCode('new@example.com')
  f.advance(600000)
  assert.equal((await f.register(f.messages.at(-1).code)).ok, false)
  assert.equal(f.service.store.users.size, 0)
})

test('mail errors fail closed without returning SMTP secrets; per-address hourly limit survives cooldown', async () => {
  const failing = fixture({ mailer: { sendRegistrationCode: async () => { throw new Error('private smtp response') } } })
  assert.deepEqual(await failing.service.requestRegistrationCode('new@example.com'), { ok: false, code: 'MAIL_UNAVAILABLE' })
  assert.equal((await failing.register('123456')).ok, false)
  const service = new AuthService()
  assert.equal((await service.requestRegistrationCode('new@example.com')).code, 'MAIL_UNAVAILABLE')
  assert.equal((await service.register({ email: 'new@example.com', password: 'test-password' })).ok, false)
  const f = fixture()
  for (let i = 0; i < 5; i++) { assert.equal((await f.service.requestRegistrationCode('new@example.com')).ok, true); f.advance(60000) }
  assert.equal((await f.service.requestRegistrationCode('new@example.com')).code, 'CODE_RATE_LIMITED')
})

test('verification state survives SQLite restart and remains atomically one-time across connections', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'registration-qa-'))
  const filename = join(directory, 'app.sqlite')
  let stores = createSqliteStores({ filename })
  const messages = []
  const options = { verificationSecret: Buffer.alloc(32, 4), mailer: { sendRegistrationCode: async (message) => messages.push(message) } }
  let second
  try {
    await new AuthService({ ...options, store: stores.auth }).requestRegistrationCode('new@example.com')
    stores.close(); stores = createSqliteStores({ filename }); second = createSqliteStores({ filename })
    const input = { email: 'new@example.com', password: 'test-password', verificationCode: messages[0].code }
    const results = await Promise.all([new AuthService({ ...options, store: stores.auth }).register(input), new AuthService({ ...options, store: second.auth }).register(input)])
    assert.equal(results.filter((result) => result.ok).length, 1)
    assert.equal([...stores.auth.users.values()].length, 1)
  } finally { second?.close(); stores.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('real public routes require verified registration and never return the code', async () => {
  const messages = []
  const runtime = createAppRuntime({ mailer: { sendRegistrationCode: async (message) => messages.push(message) } })
  const call = (path, body) => runtime.api.handle(new Request(`http://app.local${path}`, { method: 'POST', headers: { origin: 'http://app.local', 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  const input = { email: 'new@example.com', password: 'test-password' }
  assert.equal((await call('/api/auth/register', input)).status, 400)
  assert.equal(runtime.authService.store.users.size, 0)
  const response = await call('/api/auth/register/code', { email: input.email })
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(JSON.stringify(body).includes(messages[0].code), false)
  assert.equal((await call('/api/auth/register', { ...input, verificationCode: messages[0].code })).status, 201)
})

test('SMTP adapter requires TLS, disables logging, sends intended message, rejects unaccepted delivery', async () => {
  const sent = []; let config
  const mailer = createMailer({ SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_USER: 'test', SMTP_PASSWORD: 'test-only', SMTP_FROM: 'noreply@example.test' }, (options) => { config = options; return { sendMail: async (message) => { sent.push(message); return { accepted: [message.to] } } } })
  await mailer.sendRegistrationCode({ email: 'new@example.com', code: '123456', expiresMinutes: 10 })
  assert.equal(config.requireTLS, true); assert.equal(config.debug, false); assert.equal(config.logger, false)
  assert.equal(sent[0].to, 'new@example.com'); assert.ok(sent[0].text.includes('123456'))
  assert.deepEqual(createMailer({}), {})
  const rejected = createMailer({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'test', SMTP_PASSWORD: 'test-only', SMTP_FROM: 'noreply@example.test' }, () => ({ sendMail: async () => ({ accepted: [], rejected: ['new@example.com'] }) }))
  await assert.rejects(rejected.sendRegistrationCode({ email: 'new@example.com', code: '123456', expiresMinutes: 10 }), /Mail delivery unavailable/u)
})

test('resend replaces old challenge and request limits are shared across emails on one client', async () => {
  const f = fixture()
  await f.service.requestRegistrationCode('new@example.com')
  const previous = f.service.store.registrationChallenges.get('email:new@example.com').digest
  f.advance(60000)
  await f.service.requestRegistrationCode('new@example.com')
  const current = f.service.store.registrationChallenges.get('email:new@example.com')
  assert.equal(current.ready, true); assert.equal(current.attempts, 0)
  // Random codes can theoretically repeat; only a differing old code must fail.
  if (current.digest !== previous) assert.equal((await f.register(f.messages[0].code)).ok, false)
  assert.equal((await f.register(f.messages.at(-1).code)).ok, true)
  for (let i = 0; i < 8; i++) assert.equal((await f.service.requestRegistrationCode(`address${i}@example.com`)).ok, true)
  assert.equal((await f.service.requestRegistrationCode('blocked@example.com')).code, 'CODE_RATE_LIMITED')
})
