import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthService, MemoryAuthStore } from './auth-service.js'
import { CreditLedgerService, MemoryCreditStore } from './credit-ledger.js'
import { MemoryPaymentStore, PaymentService } from './payment-service.js'

async function fixture() {
  let now = Date.UTC(2026, 0, 1)
  const authService = new AuthService({ store: new MemoryAuthStore(), clock: () => now })
  await authService.provisionUser({ email: 'user@example.com', password: 'correct-horse' })
  await authService.provisionUser({ email: 'other@example.com', password: 'correct-horse' })
  const user = await authService.login({ email: 'user@example.com', password: 'correct-horse' })
  const other = await authService.login({ email: 'other@example.com', password: 'correct-horse' })
  const ledger = new CreditLedgerService({ authService, store: new MemoryCreditStore(), clock: () => now })
  const provider = {
    createPayment: ({ orderId }) => ({ providerPaymentId: `provider_${orderId}`, checkoutUrl: `/checkout/${orderId}` }),
    verifyCallback: ({ signature }) => signature === 'valid-signature',
  }
  return { authService, user, other, ledger, provider, store: new MemoryPaymentStore(), now: () => now, service: new PaymentService({ authService, creditLedger: ledger, provider, store: new MemoryPaymentStore(), clock: () => now }) }
}

function callbackFor(order, user, overrides = {}) {
  return { eventId: `event_${order.id}`, orderId: order.id, providerPaymentId: order.providerPaymentId, status: 'paid', amountFen: order.amountFen, currency: order.currency, userId: user.id, signature: 'valid-signature', ...overrides }
}

test('maps custom low amounts and fixed packs', async () => {
  const fixtureData = await fixture()
  for (const [amountYuan, credits] of [[1, 1], [9, 9], [10, 12], [30, 45], [100, 200]]) {
    const response = fixtureData.service.createOrder({ sessionToken: fixtureData.user.sessionToken, amountYuan })
    assert.equal(response.order.credits, credits)
  }
  assert.deepEqual(fixtureData.service.createOrder({ sessionToken: fixtureData.user.sessionToken, amountYuan: 11 }), { ok: false, code: 'INVALID_PAYMENT_AMOUNT' })
})

test('creates pending orders without granting credits and isolates order reads', async () => {
  const fixtureData = await fixture()
  const created = fixtureData.service.createOrder({ sessionToken: fixtureData.user.sessionToken, amountYuan: 10 })
  assert.equal(created.order.status, 'pending')
  assert.equal(fixtureData.ledger.getBalance({ sessionToken: fixtureData.user.sessionToken }).available, 3)
  assert.deepEqual(fixtureData.service.getOrder({ sessionToken: fixtureData.other.sessionToken, orderId: created.order.id }), { ok: false, code: 'NOT_FOUND' })
  assert.deepEqual(fixtureData.service.getOrder({ sessionToken: 'invalid', orderId: created.order.id }), { ok: false, code: 'UNAUTHORIZED' })
})

test('pays once, grants a twelve-month lot, and ignores duplicate events', async () => {
  const fixtureData = await fixture()
  const created = fixtureData.service.createOrder({ sessionToken: fixtureData.user.sessionToken, amountYuan: 30 })
  const callback = callbackFor(created.order, fixtureData.user.user)
  assert.deepEqual(fixtureData.service.handleCallback(callback), { ok: true, status: 'paid', credits: 45 })
  assert.deepEqual(fixtureData.service.handleCallback(callback), { ok: true, status: 'paid', credits: 45, duplicate: true })
  assert.deepEqual(fixtureData.service.handleCallback({ ...callback, signature: 'forged' }), { ok: false, code: 'INVALID_PAYMENT_EVENT' })
  assert.deepEqual(fixtureData.service.handleCallback({ ...callback, eventId: 'second-event' }), { ok: true, status: 'paid', duplicate: true })
  const balance = fixtureData.ledger.getBalance({ sessionToken: fixtureData.user.sessionToken })
  assert.equal(balance.available, 48)
  assert.equal(balance.lots.find((lot) => lot.source === `payment:${created.order.id}`).expiresAt, Date.UTC(2027, 0, 1))
})

test('rejects invalid payment events and does not grant credits', async () => {
  const fixtureData = await fixture()
  const created = fixtureData.service.createOrder({ sessionToken: fixtureData.user.sessionToken, amountYuan: 10 })
  assert.deepEqual(fixtureData.service.handleCallback(callbackFor(created.order, fixtureData.user.user, { signature: 'forged' })), { ok: false, code: 'INVALID_PAYMENT_EVENT' })
  assert.deepEqual(fixtureData.service.handleCallback(callbackFor(created.order, fixtureData.user.user, { amountFen: 999 })), { ok: false, code: 'INVALID_PAYMENT_EVENT' })
  assert.deepEqual(fixtureData.service.handleCallback(callbackFor({ ...created.order, id: 'missing-order' }, fixtureData.user.user)), { ok: false, code: 'INVALID_PAYMENT_EVENT' })
  assert.deepEqual(fixtureData.service.handleCallback(callbackFor(created.order, fixtureData.other.user)), { ok: false, code: 'INVALID_PAYMENT_EVENT' })
  assert.deepEqual(fixtureData.service.handleCallback(callbackFor(created.order, fixtureData.user.user, { status: 'pending' })), { ok: false, code: 'INVALID_PAYMENT_EVENT' })
  assert.equal(fixtureData.ledger.getBalance({ sessionToken: fixtureData.user.sessionToken }).available, 3)
})

test('failed and canceled payments never grant credits', async () => {
  const fixtureData = await fixture()
  const failedOrder = fixtureData.service.createOrder({ sessionToken: fixtureData.user.sessionToken, amountYuan: 10 })
  const canceledOrder = fixtureData.service.createOrder({ sessionToken: fixtureData.user.sessionToken, amountYuan: 100 })
  assert.deepEqual(fixtureData.service.handleCallback(callbackFor(failedOrder.order, fixtureData.user.user, { eventId: 'failed-event', status: 'failed' })), { ok: true, status: 'failed' })
  assert.deepEqual(fixtureData.service.handleCallback(callbackFor(canceledOrder.order, fixtureData.user.user, { eventId: 'canceled-event', status: 'canceled' })), { ok: true, status: 'canceled' })
  assert.equal(fixtureData.ledger.getBalance({ sessionToken: fixtureData.user.sessionToken }).available, 3)
})
