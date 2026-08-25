import { randomUUID } from 'node:crypto'

const CREDIT_EXPIRY_MONTHS = 12
const INITIAL_FREE_CREDITS = 3
const MONTHS_IN_YEAR = 12

function addMonths(timestamp, months) {
  const date = new Date(timestamp)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.getTime()
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

export class MemoryCreditStore {
  constructor() {
    this.lots = new Map()
    this.reservations = new Map()
    this.operations = new Map()
    this.initializedUsers = new Set()
  }

  transaction(work) {
    return work()
  }
}

export class CreditLedgerService {
  constructor({ authService, store = new MemoryCreditStore(), clock = () => Date.now() } = {}) {
    if (!authService) throw new Error('authService is required')
    this.authService = authService
    this.store = store
    this.clock = clock
  }

  initializeUser({ sessionToken }) {
    const user = this.#user(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    return this.initializeUserForId({ userId: user.id })
  }

  initializeUserForId({ userId }) {
    return this.store.transaction(() => {
      if (this.store.initializedUsers.has(userId)) return { ok: true, created: false }
      this.store.initializedUsers.add(userId)
      this.#grantForUser({ userId, amount: INITIAL_FREE_CREDITS, source: 'free_signup' })
      return { ok: true, created: true }
    })
  }

  grant({ sessionToken, amount, source = 'grant', expiresAt }) {
    const user = this.#user(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    return this.grantForUser({ userId: user.id, amount, source, expiresAt })
  }

  grantForUser({ userId, amount, source = 'grant', createdAt = this.clock(), expiresAt }) {
    if (!positiveInteger(amount)) return { ok: false, code: 'INVALID_CREDIT_AMOUNT' }
    const lot = this.#grantForUser({ userId, amount, source, createdAt, expiresAt })
    return { ok: true, lot: this.#publicLot(lot) }
  }

  getBalance({ sessionToken }) {
    const user = this.#user(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    return this.getBalanceForUser({ userId: user.id })
  }

  getBalanceForUser({ userId }) {
    this.initializeUserForId({ userId })
    const now = this.clock()
    const lots = this.#lotsForUser(userId)
    const available = lots.reduce((total, lot) => total + this.#available(lot, now), 0)
    return { ok: true, available, lots: lots.map((lot) => this.#publicLot(lot, now)) }
  }

  reserve({ sessionToken, operationId, amount = 1 }) {
    const user = this.#user(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    return this.reserveForUser({ userId: user.id, operationId, amount })
  }

  reserveForUser({ userId, operationId, amount = 1 }) {
    if (!operationId || !positiveInteger(amount)) return { ok: false, code: 'INVALID_RESERVATION' }
    return this.store.transaction(() => {
      this.initializeUserForId({ userId })
      const operationKey = `${userId}:${operationId}`
      const existing = this.store.operations.get(operationKey)
      if (existing) return { ok: true, reservation: this.#publicReservation(existing) }
      const now = this.clock()
      const lots = this.#lotsForUser(userId)
      const allocations = []
      let remaining = amount
      for (const lot of lots.sort((left, right) => left.expiresAt - right.expiresAt || left.createdAt - right.createdAt || left.id.localeCompare(right.id))) {
        const available = this.#available(lot, now)
        if (available <= 0) continue
        const quantity = Math.min(available, remaining)
        lot.reserved += quantity
        allocations.push({ lotId: lot.id, quantity })
        remaining -= quantity
        if (remaining === 0) break
      }
      if (remaining > 0) {
        for (const allocation of allocations) lots.find((lot) => lot.id === allocation.lotId).reserved -= allocation.quantity
        return { ok: false, code: 'INSUFFICIENT_CREDITS' }
      }
      this.store.lots.set(userId, lots)
      const reservation = { id: `reservation_${randomUUID()}`, userId, operationId, amount, allocations, status: 'reserved', createdAt: now }
      this.store.reservations.set(reservation.id, reservation)
      this.store.operations.set(operationKey, reservation)
      return { ok: true, reservation: this.#publicReservation(reservation) }
    })
  }

  settle({ sessionToken, reservationId }) {
    const user = this.#user(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    return this.settleForUser({ userId: user.id, reservationId })
  }

  settleForUser({ userId, reservationId }) {
    return this.store.transaction(() => {
      const reservation = this.store.reservations.get(reservationId)
      if (!reservation || reservation.userId !== userId) return { ok: false, code: 'RESERVATION_NOT_FOUND' }
      if (reservation.status === 'settled') return { ok: true, reservation: this.#publicReservation(reservation) }
      if (reservation.status === 'released') return { ok: false, code: 'RESERVATION_RELEASED' }
      const lots = this.#lotsForUser(userId)
      for (const allocation of reservation.allocations) {
        const lot = lots.find((candidate) => candidate.id === allocation.lotId)
        if (!lot) throw new Error('credit lot not found')
        lot.reserved -= allocation.quantity
        lot.consumed += allocation.quantity
      }
      reservation.status = 'settled'
      reservation.settledAt = this.clock()
      this.store.lots.set(userId, lots)
      this.store.reservations.set(reservationId, reservation)
      this.store.operations.set(`${userId}:${reservation.operationId}`, reservation)
      return { ok: true, reservation: this.#publicReservation(reservation) }
    })
  }

  release({ sessionToken, reservationId }) {
    const user = this.#user(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    return this.releaseForUser({ userId: user.id, reservationId })
  }

  releaseForUser({ userId, reservationId }) {
    return this.store.transaction(() => {
      const reservation = this.store.reservations.get(reservationId)
      if (!reservation || reservation.userId !== userId) return { ok: false, code: 'RESERVATION_NOT_FOUND' }
      if (reservation.status === 'released') return { ok: true, reservation: this.#publicReservation(reservation) }
      if (reservation.status === 'settled') return { ok: false, code: 'RESERVATION_SETTLED' }
      const lots = this.#lotsForUser(userId)
      for (const allocation of reservation.allocations) {
        const lot = lots.find((candidate) => candidate.id === allocation.lotId)
        if (!lot) throw new Error('credit lot not found')
        lot.reserved -= allocation.quantity
      }
      reservation.status = 'released'
      reservation.releasedAt = this.clock()
      this.store.lots.set(userId, lots)
      this.store.reservations.set(reservationId, reservation)
      this.store.operations.set(`${userId}:${reservation.operationId}`, reservation)
      return { ok: true, reservation: this.#publicReservation(reservation) }
    })
  }

  #user(sessionToken) {
    return this.authService.getSession(sessionToken)
  }

  #grantForUser({ userId, amount, source, createdAt = this.clock(), expiresAt = addMonths(createdAt, CREDIT_EXPIRY_MONTHS) }) {
    const lot = { id: `credit_lot_${randomUUID()}`, userId, amount, consumed: 0, reserved: 0, source, createdAt, expiresAt }
    const userLots = this.store.lots.get(userId) ?? []
    userLots.push(lot)
    this.store.lots.set(userId, userLots)
    return lot
  }

  #lotsForUser(userId) {
    return this.store.lots.get(userId) ?? []
  }

  #available(lot, now) {
    if (lot.expiresAt <= now) return 0
    return Math.max(0, lot.amount - lot.consumed - lot.reserved)
  }

  #publicLot(lot, now = this.clock()) {
    return { id: lot.id, source: lot.source, amount: lot.amount, consumed: lot.consumed, reserved: lot.reserved, available: this.#available(lot, now), createdAt: lot.createdAt, expiresAt: lot.expiresAt }
  }

  #publicReservation(reservation) {
    return { id: reservation.id, operationId: reservation.operationId, amount: reservation.amount, status: reservation.status, allocations: reservation.allocations.map((allocation) => ({ ...allocation })) }
  }
}

export const creditConstants = { CREDIT_EXPIRY_MONTHS, INITIAL_FREE_CREDITS, MONTHS_IN_YEAR }
