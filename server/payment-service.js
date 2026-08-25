import { randomUUID } from 'node:crypto'

const CURRENCY = 'CNY'
const PAYMENT_STATUSES = new Set(['pending', 'paid', 'failed', 'canceled'])
const CALLBACK_STATUSES = new Set(['paid', 'failed', 'canceled'])

function creditsForAmount(amountYuan) {
  if (!Number.isSafeInteger(amountYuan) || amountYuan < 1) return null
  if (amountYuan >= 1 && amountYuan <= 9) return amountYuan
  return { 10: 12, 30: 45, 100: 200 }[amountYuan] ?? null
}

export class MemoryPaymentStore {
  constructor() {
    this.orders = new Map()
    this.events = new Map()
  }

  transaction(work) {
    return work()
  }
}

export class PaymentService {
  constructor({ authService, creditLedger, store = new MemoryPaymentStore(), provider, clock = () => Date.now() } = {}) {
    if (!authService) throw new Error('authService is required')
    if (!creditLedger) throw new Error('creditLedger is required')
    if (!provider) throw new Error('provider is required')
    this.authService = authService
    this.creditLedger = creditLedger
    this.store = store
    this.provider = provider
    this.clock = clock
  }

  createOrder({ sessionToken, amountYuan }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    const credits = creditsForAmount(amountYuan)
    if (!credits) return { ok: false, code: 'INVALID_PAYMENT_AMOUNT' }
    const order = { id: `order_${randomUUID()}`, userId: user.id, amountYuan, amountFen: amountYuan * 100, currency: CURRENCY, credits, status: 'pending', createdAt: this.clock(), updatedAt: this.clock() }
    this.store.orders.set(order.id, order)
    try {
      const payment = this.provider.createPayment({ orderId: order.id, amountFen: order.amountFen, currency: order.currency })
      order.providerPaymentId = String(payment.providerPaymentId)
      order.checkoutUrl = payment.checkoutUrl ? String(payment.checkoutUrl) : null
      order.updatedAt = this.clock()
      this.store.orders.set(order.id, order)
      return { ok: true, order: this.#publicOrder(order) }
    } catch {
      order.status = 'failed'
      order.updatedAt = this.clock()
      this.store.orders.set(order.id, order)
      return { ok: false, code: 'PAYMENT_PROVIDER_UNAVAILABLE' }
    }
  }

  getOrder({ sessionToken, orderId }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    const order = this.store.orders.get(orderId)
    if (!order || order.userId !== user.id) return { ok: false, code: 'NOT_FOUND' }
    return { ok: true, order: this.#publicOrder(order) }
  }

  handleCallback({ eventId, orderId, providerPaymentId, status, amountFen, currency, userId, signature }) {
    if (!eventId || !orderId || !CALLBACK_STATUSES.has(status)) return { ok: false, code: 'INVALID_PAYMENT_EVENT' }
    try {
      if (!this.provider.verifyCallback({ eventId, orderId, providerPaymentId, status, amountFen, currency, userId, signature })) return { ok: false, code: 'INVALID_PAYMENT_EVENT' }
    } catch {
      return { ok: false, code: 'INVALID_PAYMENT_EVENT' }
    }
    return this.store.transaction(() => {
      const knownEvent = this.store.events.get(eventId)
      if (knownEvent) return { ...knownEvent, duplicate: true }
      const order = this.store.orders.get(orderId)
      if (!order || order.providerPaymentId !== providerPaymentId || order.userId !== userId || order.amountFen !== amountFen || order.currency !== currency) return { ok: false, code: 'INVALID_PAYMENT_EVENT' }
      if (order.status === 'paid') return { ok: true, status: 'paid', duplicate: true }
      if (order.status !== 'pending') return { ok: false, code: 'ORDER_NOT_PAYABLE' }
      if (status === 'failed' || status === 'canceled') {
        order.status = status
        order.updatedAt = this.clock()
        this.store.orders.set(order.id, order)
        const result = { ok: true, status }
        this.store.events.set(eventId, result)
        return result
      }
      const grant = this.creditLedger.grantForUser({ userId: order.userId, amount: order.credits, source: `payment:${order.id}`, createdAt: this.clock() })
      if (!grant.ok) return { ok: false, code: 'CREDIT_GRANT_FAILED' }
      order.status = 'paid'
      order.paidAt = this.clock()
      order.updatedAt = order.paidAt
      this.store.orders.set(order.id, order)
      const result = { ok: true, status: 'paid', credits: order.credits }
      this.store.events.set(eventId, result)
      return result
    })
  }

  #publicOrder(order) {
    return { id: order.id, amountYuan: order.amountYuan, amountFen: order.amountFen, currency: order.currency, credits: order.credits, status: order.status, providerPaymentId: order.providerPaymentId ?? null, checkoutUrl: order.checkoutUrl ?? null, createdAt: order.createdAt, updatedAt: order.updatedAt, ...(order.paidAt ? { paidAt: order.paidAt } : {}) }
  }
}

export const paymentConstants = { CURRENCY, PAYMENT_STATUSES, creditsForAmount }
