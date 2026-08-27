import { createHash, randomBytes, randomUUID } from 'node:crypto'

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const MAX_CREDITS = 100_000
const MAX_REDEMPTIONS = 100_000

function positiveInteger(value, maximum) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum
}

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/gu, '')
}

function digestCode(value) {
  return createHash('sha256').update(normalizeCode(value)).digest('hex')
}

function randomGroup(length = 4) {
  const bytes = randomBytes(length)
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
}

function generateCode() {
  return `ROOM-${randomGroup()}-${randomGroup()}-${randomGroup()}`
}

function previewCode(code) {
  return `ROOM-••••-••••-${code.slice(-4)}`
}

export class MemoryRedemptionCodeStore {
  constructor() {
    this.codes = new Map()
    this.redemptions = new Map()
  }

  transaction(work) {
    return work()
  }
}

export class RedemptionCodeService {
  constructor({ authService, creditLedger, store = new MemoryRedemptionCodeStore(), isAdmin = () => false, clock = () => Date.now(), codeGenerator = generateCode } = {}) {
    if (!authService || !creditLedger) throw new Error('authService and creditLedger are required')
    this.authService = authService
    this.creditLedger = creditLedger
    this.store = store
    this.isAdmin = isAdmin
    this.clock = clock
    this.codeGenerator = codeGenerator
  }

  create({ sessionToken, credits, maxRedemptions }) {
    const admin = this.#authorizedAdmin(sessionToken)
    if (!admin.ok) return admin
    if (!positiveInteger(credits, MAX_CREDITS) || !positiveInteger(maxRedemptions, MAX_REDEMPTIONS)) return { ok: false, code: 'VALIDATION_ERROR' }
    return this.store.transaction(() => {
      let code
      let digest
      for (let attempt = 0; attempt < 10; attempt += 1) {
        code = normalizeCode(this.codeGenerator())
        if (!/^ROOM-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/u.test(code)) throw new Error('generated redemption code is invalid')
        digest = digestCode(code)
        if (!this.store.codes.has(digest)) break
        code = null
      }
      if (!code) throw new Error('could not generate a unique redemption code')
      const record = {
        id: `redemption_code_${randomUUID()}`,
        preview: previewCode(code),
        credits,
        maxRedemptions,
        redeemedCount: 0,
        createdAt: this.clock(),
        createdBy: admin.user.id,
      }
      this.store.codes.set(digest, record)
      return { ok: true, code, redemptionCode: this.#publicCode(record) }
    })
  }

  list({ sessionToken }) {
    const admin = this.#authorizedAdmin(sessionToken)
    if (!admin.ok) return admin
    return {
      ok: true,
      redemptionCodes: [...this.store.codes.values()]
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((record) => this.#publicCode(record)),
    }
  }

  redeem({ sessionToken, code }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    const normalized = normalizeCode(code)
    if (!/^ROOM-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/u.test(normalized)) return { ok: false, code: 'INVALID_REDEMPTION_CODE' }
    const digest = digestCode(normalized)
    return this.store.transaction(() => {
      const record = this.store.codes.get(digest)
      if (!record) return { ok: false, code: 'INVALID_REDEMPTION_CODE' }
      const redemptionKey = `${record.id}:${user.id}`
      if (this.store.redemptions.has(redemptionKey)) return { ok: false, code: 'REDEMPTION_CODE_ALREADY_USED' }
      if (record.redeemedCount >= record.maxRedemptions) return { ok: false, code: 'REDEMPTION_CODE_EXHAUSTED' }
      const grant = this.creditLedger.grantForUser({
        userId: user.id,
        amount: record.credits,
        source: 'redemption_code',
        idempotencyKey: `redemption:${redemptionKey}`,
      })
      if (!grant.ok) return grant
      const redeemedAt = this.clock()
      this.store.redemptions.set(redemptionKey, { id: redemptionKey, codeId: record.id, userId: user.id, credits: record.credits, redeemedAt })
      record.redeemedCount += 1
      this.store.codes.set(digest, record)
      const balance = this.creditLedger.getBalanceForUser({ userId: user.id })
      return { ok: true, creditsAdded: record.credits, available: balance.available, redeemedAt }
    })
  }

  #authorizedAdmin(sessionToken) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    return this.isAdmin(user) ? { ok: true, user } : { ok: false, code: 'FORBIDDEN' }
  }

  #publicCode(record) {
    return {
      id: record.id,
      preview: record.preview,
      credits: record.credits,
      maxRedemptions: record.maxRedemptions,
      redeemedCount: record.redeemedCount,
      remainingRedemptions: Math.max(0, record.maxRedemptions - record.redeemedCount),
      createdAt: record.createdAt,
    }
  }
}

export const redemptionCodeConstants = { MAX_CREDITS, MAX_REDEMPTIONS }
