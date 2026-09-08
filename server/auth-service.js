import { createHash, createHmac, randomInt, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8
const RESET_TTL_MS = 30 * 60 * 1000
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase()
const digest = (value) => createHash('sha256').update(value).digest('hex')
const makeToken = () => randomBytes(32).toString('base64url')

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64)
  return `scrypt:${salt}:${Buffer.from(derived).toString('hex')}`
}

async function verifyPassword(password, stored) {
  const [, salt, expectedHex] = String(stored).split(':')
  if (!salt || !expectedHex) return false
  const actual = Buffer.from(await scrypt(password, salt, 64))
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= PASSWORD_MIN_LENGTH
}

export class MemoryAuthStore {
  constructor(clock = () => Date.now()) {
    this.clock = clock
    this.users = new Map()
    this.sessions = new Map()
    this.resetTokens = new Map()
    this.registrationChallenges = new Map()
  }

  transaction(work) {
    return work()
  }
}

export class AuthService {
  constructor({ store = new MemoryAuthStore(), mailer = {}, clock, verificationSecret = randomBytes(32), reservedRegistrationEmails = [] } = {}) {
    this.store = store
    this.mailer = mailer
    this.clock = clock ?? (() => Date.now())
    this.verificationSecret = verificationSecret
    this.reservedRegistrationEmails = new Set(reservedRegistrationEmails.map(normalizeEmail))
  }

  #codeDigest(email, code) {
    return createHmac('sha256', this.verificationSecret).update(`${email}:${code}`).digest('hex')
  }

  async requestRegistrationCode(email, clientAddress = 'local') {
    const normalizedEmail = normalizeEmail(email)
    if (!EMAIL_PATTERN.test(normalizedEmail)) return { ok: false, code: 'INVALID_EMAIL' }
    if (!this.mailer.sendRegistrationCode) return { ok: false, code: 'MAIL_UNAVAILABLE' }
    const now = this.clock()
    const key = `email:${normalizedEmail}`
    const ipKey = `ip:${digest(clientAddress)}`
    const code = String(randomInt(0, 1000000)).padStart(6, '0')
    const challenge = this.store.transaction(() => {
      for (const [entryKey, entry] of this.store.registrationChallenges) {
        if (now - entry.windowStart >= 3600000) this.store.registrationChallenges.delete(entryKey)
      }
      const previous = this.store.registrationChallenges.get(key)
      const ip = this.store.registrationChallenges.get(ipKey)
      if ((previous && now - previous.sentAt < 60000) || (previous?.sends ?? 0) >= 5 || (ip?.sends ?? 0) >= 10) return null
      const value = { digest: this.#codeDigest(normalizedEmail, code), sentAt: now, expiresAt: now + 600000, attempts: 0, ready: false, sends: (previous?.sends ?? 0) + 1, windowStart: previous?.windowStart ?? now }
      this.store.registrationChallenges.set(key, value)
      this.store.registrationChallenges.set(ipKey, { sends: (ip?.sends ?? 0) + 1, windowStart: ip?.windowStart ?? now })
      return value
    })
    if (!challenge) return { ok: false, code: 'CODE_RATE_LIMITED' }
    try {
      // Do not send registration mail for existing/reserved accounts; response stays generic.
      if (!this.store.users.has(normalizedEmail) && !this.reservedRegistrationEmails.has(normalizedEmail)) {
        await this.mailer.sendRegistrationCode({ email: normalizedEmail, code, expiresMinutes: 10 })
      }
      this.store.transaction(() => {
        const current = this.store.registrationChallenges.get(key)
        if (current?.digest === challenge.digest) this.store.registrationChallenges.set(key, { ...current, ready: true })
      })
      return { ok: true, retryAfterSeconds: 60 }
    } catch {
      return { ok: false, code: 'MAIL_UNAVAILABLE' }
    }
  }

  async register({ email, password, verificationCode }) {
    const normalizedEmail = normalizeEmail(email)
    if (!EMAIL_PATTERN.test(normalizedEmail)) return { ok: false, code: 'INVALID_EMAIL' }
    if (!validPassword(password)) return { ok: false, code: 'INVALID_PASSWORD' }
    if (this.reservedRegistrationEmails.has(normalizedEmail)) return { ok: false, code: 'EMAIL_ALREADY_REGISTERED' }
    if (this.store.users.has(normalizedEmail)) return { ok: false, code: 'EMAIL_ALREADY_REGISTERED' }
    const key = `email:${normalizedEmail}`
    const invalid = () => ({ ok: false, code: 'INVALID_VERIFICATION_CODE' })
    // Consume an attempt before expensive password hashing, including malformed codes.
    const matched = this.store.transaction(() => {
      const challenge = this.store.registrationChallenges.get(key)
      if (!challenge?.ready || challenge.expiresAt <= this.clock() || challenge.attempts >= 5) return null
      challenge.attempts += 1
      this.store.registrationChallenges.set(key, challenge)
      return /^\d{6}$/u.test(String(verificationCode ?? '')) && timingSafeEqual(Buffer.from(challenge.digest, 'hex'), Buffer.from(this.#codeDigest(normalizedEmail, verificationCode), 'hex')) ? challenge.digest : null
    })
    if (!matched) return invalid()
    const passwordHash = await hashPassword(password)
    return this.store.transaction(() => {
      const challenge = this.store.registrationChallenges.get(key)
      if (!challenge?.ready || challenge.digest !== matched || challenge.expiresAt <= this.clock()) return invalid()
      if (this.store.users.has(normalizedEmail)) return { ok: false, code: 'EMAIL_ALREADY_REGISTERED' }
      const user = { id: `user_${randomBytes(10).toString('hex')}`, email: normalizedEmail, passwordHash, createdAt: this.clock(), emailVerifiedAt: this.clock() }
      this.store.users.set(normalizedEmail, user)
      this.store.registrationChallenges.set(key, { ...challenge, ready: false, digest: null })
      return { ok: true, user: { id: user.id, email: user.email } }
    })
  }

  async provisionUser({ email, password }) {
    const normalizedEmail = normalizeEmail(email)
    if (!EMAIL_PATTERN.test(normalizedEmail)) return { ok: false, code: 'INVALID_EMAIL' }
    if (!validPassword(password)) return { ok: false, code: 'INVALID_PASSWORD' }
    return this.#createUser(normalizedEmail, password)
  }

  async #createUser(normalizedEmail, password) {
    if (this.store.users.has(normalizedEmail)) return { ok: false, code: 'EMAIL_ALREADY_REGISTERED' }
    const user = { id: `user_${randomBytes(10).toString('hex')}`, email: normalizedEmail, passwordHash: await hashPassword(password), createdAt: this.clock() }
    return this.store.transaction(() => {
      if (this.store.users.has(normalizedEmail)) return { ok: false, code: 'EMAIL_ALREADY_REGISTERED' }
      this.store.users.set(normalizedEmail, user)
      return { ok: true, user: { id: user.id, email: user.email } }
    })
  }

  async login({ email, password }) {
    const user = this.store.users.get(normalizeEmail(email))
    if (!user || !(await verifyPassword(password, user.passwordHash))) return { ok: false, code: 'INVALID_CREDENTIALS' }
    const token = makeToken()
    this.store.sessions.set(digest(token), { userId: user.id, expiresAt: this.clock() + SESSION_TTL_MS })
    return { ok: true, sessionToken: token, user: { id: user.id, email: user.email }, expiresAt: this.clock() + SESSION_TTL_MS }
  }

  getSession(sessionToken) {
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) return null
    const session = this.store.sessions.get(digest(sessionToken))
    if (!session || session.expiresAt <= this.clock()) return null
    const user = [...this.store.users.values()].find((candidate) => candidate.id === session.userId)
    return user ? { id: user.id, email: user.email } : null
  }

  logout(sessionToken) {
    this.store.sessions.delete(digest(sessionToken))
  }

  async requestPasswordReset(email) {
    const normalizedEmail = normalizeEmail(email)
    const user = this.store.users.get(normalizedEmail)
    if (user) {
      const token = makeToken()
      this.store.resetTokens.set(digest(token), { userId: user.id, expiresAt: this.clock() + RESET_TTL_MS })
      await this.mailer.sendPasswordReset({ email: user.email, token })
    }
    return { ok: true }
  }

  async resetPassword({ token, password }) {
    if (!validPassword(password)) return { ok: false, code: 'INVALID_PASSWORD' }
    const tokenKey = digest(token)
    const reset = this.store.resetTokens.get(tokenKey)
    if (!reset || reset.expiresAt <= this.clock()) return { ok: false, code: 'INVALID_OR_EXPIRED_RESET' }
    const userEntry = [...this.store.users.entries()].find(([, candidate]) => candidate.id === reset.userId)
    const user = userEntry?.[1]
    if (!user) return { ok: false, code: 'INVALID_OR_EXPIRED_RESET' }
    user.passwordHash = await hashPassword(password)
    this.store.users.set(userEntry[0], user)
    this.store.resetTokens.delete(tokenKey)
    for (const [sessionKey, session] of this.store.sessions) if (session.userId === user.id) this.store.sessions.delete(sessionKey)
    return { ok: true }
  }
}

export const authConstants = { PASSWORD_MIN_LENGTH, RESET_TTL_MS, SESSION_TTL_MS }
