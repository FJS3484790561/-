import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'

const MASKED_SECRET = '********'
const CONFIG_ACTIONS = new Set(['created', 'updated', 'enabled', 'disabled'])
const REQUIRED_TEXT_FIELDS = ['name', 'endpoint', 'model']

function assertEncryptionKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('encryptionKey must be a 32-byte Buffer')
}

function encryptSecret(secret, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
}

function decryptSecret(payload, key) {
  const [ivValue, tagValue, ciphertextValue] = String(payload).split('.')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8')
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function publicConfig(config) {
  return {
    id: config.id,
    name: config.name,
    endpoint: config.endpoint,
    model: config.model,
    enabled: config.enabled,
    apiKeyConfigured: Boolean(config.encryptedApiKey),
    apiKeyMasked: config.encryptedApiKey ? MASKED_SECRET : null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }
}

export class MemoryAdminProviderStore {
  constructor() {
    this.configs = new Map()
    this.audit = []
  }

  transaction(work) {
    return work()
  }
}

export class AdminProviderService {
  constructor({ authService, store = new MemoryAdminProviderStore(), encryptionKey, isAdmin, canManage = () => true, clock = () => Date.now() } = {}) {
    if (!authService) throw new Error('authService is required')
    if (typeof isAdmin !== 'function') throw new Error('isAdmin is required')
    assertEncryptionKey(encryptionKey)
    this.authService = authService
    this.store = store
    this.encryptionKey = encryptionKey
    this.isAdmin = isAdmin
    this.canManage = canManage
    this.clock = clock
  }

  list({ sessionToken }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    return { ok: true, providers: [...this.store.configs.values()].filter((config) => this.canManage(access.user.id, config.name)).map(publicConfig) }
  }

  get({ sessionToken, providerId }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    const config = this.store.configs.get(providerId)
    if (!config || !this.canManage(access.user.id, config.name)) return { ok: false, code: 'NOT_FOUND' }
    return { ok: true, provider: publicConfig(config) }
  }

  create({ sessionToken, name, endpoint, model, apiKey }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    const fields = this.#validate({ name, endpoint, model, apiKey }, { requireKey: true })
    if (fields) return { ok: false, code: 'VALIDATION_ERROR', fields }
    if (!this.canManage(access.user.id, name)) return { ok: false, code: 'FORBIDDEN' }
    if ([...this.store.configs.values()].some((config) => config.name === name)) return { ok: false, code: 'PROVIDER_ALREADY_EXISTS' }
    const now = this.clock()
    const config = { id: `provider_${randomUUID()}`, name, endpoint, model, encryptedApiKey: encryptSecret(apiKey, this.encryptionKey), enabled: false, createdAt: now, updatedAt: now }
    this.store.transaction(() => {
      this.store.configs.set(config.id, config)
      this.#record(access.user.id, config, 'created')
    })
    return { ok: true, provider: publicConfig(config) }
  }

  update({ sessionToken, providerId, name, endpoint, model, apiKey }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    const config = this.store.configs.get(providerId)
    if (!config || !this.canManage(access.user.id, config.name)) return { ok: false, code: 'NOT_FOUND' }
    const nextName = name === undefined ? config.name : cleanText(name)
    const nextEndpoint = endpoint === undefined ? config.endpoint : cleanText(endpoint)
    const nextModel = model === undefined ? config.model : cleanText(model)
    const fields = this.#validate({ name: nextName, endpoint: nextEndpoint, model: nextModel, apiKey }, { requireKey: false, allowMissingKey: true })
    if (fields) return { ok: false, code: 'VALIDATION_ERROR', fields }
    if (!this.canManage(access.user.id, nextName)) return { ok: false, code: 'FORBIDDEN' }
    if ([...this.store.configs.values()].some((candidate) => candidate.id !== providerId && candidate.name === nextName)) return { ok: false, code: 'PROVIDER_ALREADY_EXISTS' }
    const updated = { ...config, name: nextName, endpoint: nextEndpoint, model: nextModel, encryptedApiKey: apiKey === undefined ? config.encryptedApiKey : encryptSecret(apiKey, this.encryptionKey), updatedAt: this.clock() }
    this.store.transaction(() => {
      this.store.configs.set(providerId, updated)
      this.#record(access.user.id, updated, 'updated')
    })
    return { ok: true, provider: publicConfig(updated) }
  }

  setEnabled({ sessionToken, providerId, enabled }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    const config = this.store.configs.get(providerId)
    if (!config || !this.canManage(access.user.id, config.name)) return { ok: false, code: 'NOT_FOUND' }
    if (typeof enabled !== 'boolean') return { ok: false, code: 'VALIDATION_ERROR', fields: { enabled: 'enabled must be boolean' } }
    const updated = { ...config, enabled, updatedAt: this.clock() }
    this.store.transaction(() => {
      this.store.configs.set(providerId, updated)
      this.#record(access.user.id, updated, enabled ? 'enabled' : 'disabled')
    })
    return { ok: true, provider: publicConfig(updated) }
  }

  listAudit({ sessionToken, providerId }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    const config = this.store.configs.get(providerId)
    if (!config || !this.canManage(access.user.id, config.name)) return { ok: false, code: 'NOT_FOUND' }
    return { ok: true, audit: this.store.audit.filter((entry) => entry.providerId === providerId).map((entry) => ({ ...entry })) }
  }

  readSecretForProvider({ providerId }) {
    const config = this.store.configs.get(providerId)
    if (!config || !config.enabled) return { ok: false, code: 'PROVIDER_NOT_AVAILABLE' }
    return { ok: true, apiKey: decryptSecret(config.encryptedApiKey, this.encryptionKey) }
  }

  #authorize(sessionToken) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    if (!this.isAdmin(user)) return { ok: false, code: 'FORBIDDEN' }
    return { ok: true, user }
  }

  #validate({ name, endpoint, model, apiKey }, { requireKey, allowMissingKey = false }) {
    const fields = {}
    for (const field of REQUIRED_TEXT_FIELDS) if (!cleanText({ name, endpoint, model }[field])) fields[field] = `${field} is required`
    if (requireKey && !cleanText(apiKey)) fields.apiKey = 'apiKey is required'
    if (!allowMissingKey && apiKey !== undefined && !cleanText(apiKey)) fields.apiKey = 'apiKey is required'
    if (apiKey !== undefined && typeof apiKey !== 'string') fields.apiKey = 'apiKey must be text'
    return Object.keys(fields).length ? fields : null
  }

  #record(actorId, config, action) {
    if (!CONFIG_ACTIONS.has(action)) throw new Error('unknown provider audit action')
    this.store.audit.push({ id: `provider_audit_${randomUUID()}`, actorId, providerId: config.id, providerName: config.name, action, occurredAt: this.clock() })
  }
}

export const adminProviderConstants = { MASKED_SECRET, CONFIG_ACTIONS }
