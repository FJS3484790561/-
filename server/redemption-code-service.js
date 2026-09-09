import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const MAX_CREDITS = 100_000
const MAX_REDEMPTIONS = 100_000
const CODE_PATTERN = /^ROOM-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/u

function positiveInteger(value, maximum) { return Number.isSafeInteger(value) && value > 0 && value <= maximum }
function normalizeCode(value) { return String(value ?? '').trim().toUpperCase().replace(/\s+/gu, '') }
function digestCode(value) { return createHash('sha256').update(normalizeCode(value)).digest('hex') }
function randomGroup(length = 4) { return [...randomBytes(length)].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('') }
function generateCode() { return `ROOM-${randomGroup()}-${randomGroup()}-${randomGroup()}` }
function previewCode(code) { return `ROOM-••••-••••-${code.slice(-4)}` }

function encryptCode(code, key) {
  if (!key) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()])
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
}

function decryptCode(payload, key) {
  if (!payload || !key) return null
  try {
    const [iv, tag, ciphertext] = String(payload).split('.')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
  } catch { return null }
}

export class MemoryRedemptionCodeStore {
  constructor() { this.codes = new Map(); this.redemptions = new Map() }
  transaction(work) { return work() }
}

export class RedemptionCodeService {
  constructor({ authService, creditLedger, store = new MemoryRedemptionCodeStore(), isAdmin = () => false, clock = () => Date.now(), codeGenerator = generateCode, encryptionKey = null } = {}) {
    if (!authService || !creditLedger) throw new Error('authService and creditLedger are required')
    if (encryptionKey !== null && (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32)) throw new Error('encryptionKey must be a 32-byte Buffer')
    this.authService = authService; this.creditLedger = creditLedger; this.store = store; this.isAdmin = isAdmin; this.clock = clock; this.codeGenerator = codeGenerator; this.encryptionKey = encryptionKey
  }

  create({ sessionToken, credits, maxRedemptions }) {
    const admin = this.#authorizedAdmin(sessionToken)
    if (!admin.ok) return admin
    if (!positiveInteger(credits, MAX_CREDITS) || !positiveInteger(maxRedemptions, MAX_REDEMPTIONS)) return { ok: false, code: 'VALIDATION_ERROR' }
    return this.#createRecord({ credits, maxRedemptions, createdBy: admin.user.id })
  }

  createReward({ credits, email, source = 'reward' }) {
    if (!positiveInteger(credits, MAX_CREDITS) || typeof email !== 'string' || !email.trim()) return { ok: false, code: 'VALIDATION_ERROR' }
    return this.#createRecord({ credits, maxRedemptions: 1, boundEmail: email.trim().toLowerCase(), createdBy: source })
  }

  list({ sessionToken }) {
    const admin = this.#authorizedAdmin(sessionToken)
    if (!admin.ok) return admin
    return { ok: true, redemptionCodes: [...this.store.codes.values()].sort((left, right) => right.createdAt - left.createdAt).map((record) => this.#publicCode(record, true)) }
  }

  getForDelivery({ codeId }) {
    const found = [...this.store.codes.entries()].find(([, record]) => record.id === codeId)
    if (!found) return { ok: false, code: 'NOT_FOUND' }
    const code = decryptCode(found[1].encryptedCode, this.encryptionKey)
    return code ? { ok: true, code, credits: found[1].credits, email: found[1].boundEmail ?? null } : { ok: false, code: 'REDEMPTION_CODE_UNAVAILABLE' }
  }

  remove({ sessionToken, codeId }) {
    const admin = this.#authorizedAdmin(sessionToken)
    if (!admin.ok) return admin
    const found = [...this.store.codes.entries()].find(([, record]) => record.id === codeId)
    if (!found) return { ok: false, code: 'NOT_FOUND' }
    const [digest, record] = found
    if (record.deletedAt) return { ok: true, deleted: true, redemptionCode: this.#publicCode(record, true) }
    this.store.transaction(() => {
      if (record.redeemedCount > 0) { record.deletedAt = this.clock(); this.store.codes.set(digest, record) }
      else this.store.codes.delete(digest)
    })
    return { ok: true, deleted: true, redemptionCode: record.deletedAt ? this.#publicCode(record, true) : null }
  }

  redeem({ sessionToken, code }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    const normalized = normalizeCode(code)
    if (!CODE_PATTERN.test(normalized)) return { ok: false, code: 'INVALID_REDEMPTION_CODE' }
    const digest = digestCode(normalized)
    return this.store.transaction(() => {
      const record = this.store.codes.get(digest)
      if (!record || record.deletedAt) return { ok: false, code: 'INVALID_REDEMPTION_CODE' }
      if (record.boundEmail && record.boundEmail !== user.email) return { ok: false, code: 'REDEMPTION_CODE_EMAIL_MISMATCH' }
      const redemptionKey = `${record.id}:${user.id}`
      if (this.store.redemptions.has(redemptionKey)) return { ok: false, code: 'REDEMPTION_CODE_ALREADY_USED' }
      if (record.redeemedCount >= record.maxRedemptions) return { ok: false, code: 'REDEMPTION_CODE_EXHAUSTED' }
      const grant = this.creditLedger.grantForUser({ userId: user.id, amount: record.credits, source: 'redemption_code', idempotencyKey: `redemption:${redemptionKey}` })
      if (!grant.ok) return grant
      const redeemedAt = this.clock()
      this.store.redemptions.set(redemptionKey, { id: redemptionKey, codeId: record.id, userId: user.id, credits: record.credits, redeemedAt })
      record.redeemedCount += 1; this.store.codes.set(digest, record)
      const balance = this.creditLedger.getBalanceForUser({ userId: user.id })
      return { ok: true, creditsAdded: record.credits, available: balance.available, redeemedAt }
    })
  }

  #createRecord({ credits, maxRedemptions, boundEmail = null, createdBy }) {
    return this.store.transaction(() => {
      let code; let digest
      for (let attempt = 0; attempt < 10; attempt += 1) {
        code = normalizeCode(this.codeGenerator())
        if (!CODE_PATTERN.test(code)) throw new Error('generated redemption code is invalid')
        digest = digestCode(code)
        if (!this.store.codes.has(digest)) break
        code = null
      }
      if (!code) throw new Error('could not generate a unique redemption code')
      const record = { id: `redemption_code_${randomUUID()}`, encryptedCode: encryptCode(code, this.encryptionKey), preview: previewCode(code), credits, maxRedemptions, redeemedCount: 0, createdAt: this.clock(), createdBy, boundEmail, deletedAt: null }
      this.store.codes.set(digest, record)
      return { ok: true, code, redemptionCode: this.#publicCode(record, true) }
    })
  }

  #authorizedAdmin(sessionToken) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    return this.isAdmin(user) ? { ok: true, user } : { ok: false, code: 'FORBIDDEN' }
  }

  #publicCode(record, includeCode = false) {
    const code = includeCode ? decryptCode(record.encryptedCode, this.encryptionKey) : null
    return { id: record.id, preview: record.preview, ...(code ? { code } : {}), credits: record.credits, maxRedemptions: record.maxRedemptions, redeemedCount: record.redeemedCount, remainingRedemptions: Math.max(0, record.maxRedemptions - record.redeemedCount), createdAt: record.createdAt, ...(record.boundEmail ? { boundEmail: record.boundEmail } : {}), ...(record.deletedAt ? { deletedAt: record.deletedAt } : {}) }
  }
}

export const redemptionCodeConstants = { MAX_CREDITS, MAX_REDEMPTIONS }
