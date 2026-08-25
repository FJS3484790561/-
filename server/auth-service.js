import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
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
  }
}

export class AuthService {
  constructor({ store = new MemoryAuthStore(), mailer = { sendPasswordReset: async () => {} }, clock } = {}) {
    this.store = store
    this.mailer = mailer
    this.clock = clock ?? (() => Date.now())
  }

  async register({ email, password }) {
    const normalizedEmail = normalizeEmail(email)
    if (!EMAIL_PATTERN.test(normalizedEmail)) return { ok: false, code: 'INVALID_EMAIL' }
    if (!validPassword(password)) return { ok: false, code: 'INVALID_PASSWORD' }
    if (this.store.users.has(normalizedEmail)) return { ok: false, code: 'EMAIL_ALREADY_REGISTERED' }
    const user = { id: `user_${randomBytes(10).toString('hex')}`, email: normalizedEmail, passwordHash: await hashPassword(password), createdAt: this.clock() }
    this.store.users.set(normalizedEmail, user)
    return { ok: true, user: { id: user.id, email: user.email } }
  }

  async login({ email, password }) {
    const user = this.store.users.get(normalizeEmail(email))
    if (!user || !(await verifyPassword(password, user.passwordHash))) return { ok: false, code: 'INVALID_CREDENTIALS' }
    const token = makeToken()
    this.store.sessions.set(digest(token), { userId: user.id, expiresAt: this.clock() + SESSION_TTL_MS })
    return { ok: true, sessionToken: token, user: { id: user.id, email: user.email }, expiresAt: this.clock() + SESSION_TTL_MS }
  }

  getSession(sessionToken) {
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
    const user = [...this.store.users.values()].find((candidate) => candidate.id === reset.userId)
    if (!user) return { ok: false, code: 'INVALID_OR_EXPIRED_RESET' }
    user.passwordHash = await hashPassword(password)
    this.store.resetTokens.delete(tokenKey)
    for (const [sessionKey, session] of this.store.sessions) if (session.userId === user.id) this.store.sessions.delete(sessionKey)
    return { ok: true }
  }
}

export const authConstants = { PASSWORD_MIN_LENGTH, RESET_TTL_MS, SESSION_TTL_MS }
