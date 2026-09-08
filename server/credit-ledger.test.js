import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthService, MemoryAuthStore } from './auth-service.js'
import { CreditLedgerService, MemoryCreditStore } from './credit-ledger.js'

async function fixture() {
  let now = Date.UTC(2026, 0, 1)
  const authService = new AuthService({ store: new MemoryAuthStore(() => now), clock: () => now })
  await authService.provisionUser({ email: 'user@example.com', password: 'correct-horse' })
  const login = await authService.login({ email: 'user@example.com', password: 'correct-horse' })
  const ledger = new CreditLedgerService({ authService, store: new MemoryCreditStore(), clock: () => now })
  return { authService, token: login.sessionToken, userId: login.user.id, ledger, now: () => now, advance: (ms) => { now += ms } }
}

test('initializes three credits with a twelve-month expiry and is idempotent', async () => {
  const fixtureData = await fixture()
  assert.equal(fixtureData.ledger.getBalance({ sessionToken: fixtureData.token }).available, 3)
  assert.deepEqual(fixtureData.ledger.initializeUser({ sessionToken: fixtureData.token }), { ok: true, created: false })
  const balance = fixtureData.ledger.getBalance({ sessionToken: fixtureData.token })
  assert.equal(balance.available, 3)
  assert.equal(balance.lots[0].expiresAt, Date.UTC(2027, 0, 1))
})

test('skips expired lots and consumes the earliest expiring lots first', async () => {
  const fixtureData = await fixture()
  fixtureData.ledger.initializeUser({ sessionToken: fixtureData.token })
  fixtureData.ledger.grant({ sessionToken: fixtureData.token, amount: 2, source: 'pack', expiresAt: fixtureData.now() + 1_000 })
  fixtureData.ledger.grant({ sessionToken: fixtureData.token, amount: 2, source: 'pack', expiresAt: fixtureData.now() + 100_000 })
  const reservation = fixtureData.ledger.reserve({ sessionToken: fixtureData.token, operationId: 'generation-1', amount: 4 })
  assert.equal(reservation.ok, true)
  assert.deepEqual(reservation.reservation.allocations.map((item) => item.quantity), [2, 2])
  assert.equal(fixtureData.ledger.settle({ sessionToken: fixtureData.token, reservationId: reservation.reservation.id }).ok, true)
  fixtureData.advance(2_000)
  const balance = fixtureData.ledger.getBalance({ sessionToken: fixtureData.token })
  assert.equal(balance.available, 3)
})

test('settlement and release are idempotent and insufficient credit is rejected', async () => {
  const fixtureData = await fixture()
  fixtureData.ledger.initializeUser({ sessionToken: fixtureData.token })
  const reservation = fixtureData.ledger.reserve({ sessionToken: fixtureData.token, operationId: 'generation-1' })
  assert.equal(fixtureData.ledger.reserve({ sessionToken: fixtureData.token, operationId: 'generation-1' }).reservation.id, reservation.reservation.id)
  assert.equal(fixtureData.ledger.settle({ sessionToken: fixtureData.token, reservationId: reservation.reservation.id }).ok, true)
  assert.equal(fixtureData.ledger.settle({ sessionToken: fixtureData.token, reservationId: reservation.reservation.id }).ok, true)
  const released = fixtureData.ledger.reserve({ sessionToken: fixtureData.token, operationId: 'generation-2' })
  assert.equal(fixtureData.ledger.release({ sessionToken: fixtureData.token, reservationId: released.reservation.id }).ok, true)
  assert.equal(fixtureData.ledger.release({ sessionToken: fixtureData.token, reservationId: released.reservation.id }).ok, true)
  assert.deepEqual(fixtureData.ledger.reserve({ sessionToken: fixtureData.token, operationId: 'generation-3', amount: 3 }), { ok: false, code: 'INSUFFICIENT_CREDITS' })
})

test('concurrent reservations cannot over-allocate the initial balance', async () => {
  const fixtureData = await fixture()
  const reservations = await Promise.all(Array.from({ length: 4 }, (_, index) => Promise.resolve(fixtureData.ledger.reserve({ sessionToken: fixtureData.token, operationId: `generation-${index}` }))))
  assert.equal(reservations.filter((result) => result.ok).length, 3)
  assert.equal(reservations.filter((result) => result.code === 'INSUFFICIENT_CREDITS').length, 1)
})

test('uses an immutable idempotency key for grants', async () => {
  const fixtureData = await fixture()
  const first = fixtureData.ledger.grantForUser({ userId: fixtureData.userId, amount: 12, source: 'payment:one', idempotencyKey: 'payment:one' })
  const duplicate = fixtureData.ledger.grantForUser({ userId: fixtureData.userId, amount: 12, source: 'payment:one', idempotencyKey: 'payment:one' })
  assert.equal(first.ok, true)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.lot.id, first.lot.id)
  assert.deepEqual(fixtureData.ledger.grantForUser({ userId: fixtureData.userId, amount: 45, source: 'payment:other', idempotencyKey: 'payment:one' }), { ok: false, code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal([...fixtureData.ledger.store.journal.values()].filter((entry) => entry.idempotencyKey === 'payment:one').length, 1)
})
