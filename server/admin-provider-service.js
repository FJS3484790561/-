import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'

const MASKED_SECRET = '********'
const CONFIG_ACTIONS = new Set(['created', 'updated', 'enabled', 'disabled'])
const REQUIRED_TEXT_FIELDS = ['name', 'endpoint', 'model']
const PROVIDER_KINDS = new Set(['image', 'conversation'])

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
    kind: config.kind ?? 'image',
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
  constructor({ authService, store = new MemoryAdminProviderStore(), encryptionKey, isAdmin, canManage = () => true, clock = () => Date.now(), testProvider = null, logger = console } = {}) {
    if (!authService) throw new Error('authService is required')
    if (typeof isAdmin !== 'function') throw new Error('isAdmin is required')
    assertEncryptionKey(encryptionKey)
    this.authService = authService
    this.store = store
    this.encryptionKey = encryptionKey
    this.isAdmin = isAdmin
    this.canManage = canManage
    this.clock = clock
    this.testProvider = testProvider
    this.logger = logger
    this.testJobs = new Map()
  }

  startTest(input) {
    const access = this.#authorize(input.sessionToken)
    if (!access.ok) return access
    for (const [id, job] of this.testJobs) if (job.expiresAt < this.clock()) this.testJobs.delete(id)
    if ([...this.testJobs.values()].some((job) => job.userId === access.user.id && job.status === 'running')) return { ok: false, code: 'PROVIDER_TEST_BUSY' }
    const testId = 'provider_job_' + randomUUID()
    const job = { userId: access.user.id, status: 'running', expiresAt: this.clock() + 15 * 60_000 }
    this.testJobs.set(testId, job)
    // Credentials live only in this call; polling records contain safe results only.
    this.testAndSave(input).then((result) => { job.result = result; job.status = 'completed' }).catch(() => {
      job.result = { ok: false, code: 'PROVIDER_TEST_FAILED', message: 'Provider 测试未完成。' }; job.status = 'completed'
    })
    return { ok: true, testId, status: 'running' }
  }

  getTest({ sessionToken, testId }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    const job = this.testJobs.get(testId)
    if (!job || job.userId !== access.user.id || job.expiresAt < this.clock()) return { ok: false, code: 'NOT_FOUND' }
    return { ok: true, testId, status: job.status, ...(job.status === 'completed' ? { result: job.result } : {}) }
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

  create(input) {
    return this.testAndSave(input)
  }

  update(input) {
    return this.testAndSave(input)
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

  async testAndSave({ sessionToken, providerId, name, endpoint, model, kind, apiKey }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    const existing = providerId ? this.store.configs.get(providerId) : null
    if (providerId && (!existing || !this.canManage(access.user.id, existing.name))) return { ok: false, code: 'NOT_FOUND' }
    const next = { name: name === undefined ? existing?.name : cleanText(name), endpoint: endpoint === undefined ? existing?.endpoint : cleanText(endpoint), model: model === undefined ? existing?.model : cleanText(model), kind: kind === undefined ? (existing?.kind ?? 'image') : cleanText(kind) }
    const secret = apiKey === undefined ? (existing ? decryptSecret(existing.encryptedApiKey, this.encryptionKey) : '') : apiKey
    const fields = this.#validate({ ...next, apiKey: secret }, { requireKey: true })
    if (fields) return { ok: false, code: 'VALIDATION_ERROR', fields }
    if (!this.canManage(access.user.id, next.name)) return { ok: false, code: 'FORBIDDEN' }
    if ([...this.store.configs.values()].some((candidate) => candidate.id !== providerId && candidate.name === next.name)) return { ok: false, code: 'PROVIDER_ALREADY_EXISTS' }
    const traceId = `provider_test_${randomUUID()}`
    this.logger.info?.('[Provider Test]', { traceId, provider: next.name, model: next.model, stage: 'started' })
    if (typeof this.testProvider !== 'function') {
      this.logger.error?.('[Provider Test]', { traceId, provider: next.name, model: next.model, stage: 'configuration', code: 'PROVIDER_TEST_UNAVAILABLE' })
      return { ok: false, code: 'PROVIDER_TEST_UNAVAILABLE', traceId, stage: 'configuration' }
    }
    let result
    try {
      result = await this.testProvider({ ...next, apiKey: secret, traceId })
      if (!result?.ok) {
        const failure = {
          ok: false,
          code: result?.code || 'PROVIDER_TEST_FAILED',
          message: result?.message,
          traceId,
          stage: result?.stage || 'request',
          ...(result?.httpStatus ? { httpStatus: result.httpStatus } : {}),
          ...(result?.protocol ? { protocol: result.protocol } : {}),
          ...(Number.isFinite(result?.elapsedMs) ? { elapsedMs: result.elapsedMs } : {}),
          ...(result?.upstreamCode ? { upstreamCode: result.upstreamCode } : {}),
          ...(result?.upstreamMessage ? { upstreamMessage: result.upstreamMessage } : {}),
        }
        this.logger.error?.('[Provider Test]', { traceId, provider: next.name, model: next.model, stage: failure.stage, code: failure.code, httpStatus: failure.httpStatus, protocol: failure.protocol, elapsedMs: failure.elapsedMs, upstreamCode: failure.upstreamCode, upstreamMessage: failure.upstreamMessage })
        return failure
      }
    } catch (reason) {
      this.logger.error?.('[Provider Test]', { traceId, provider: next.name, model: next.model, stage: 'failed', code: reason?.code || 'PROVIDER_TEST_FAILED' })
      return { ok: false, code: reason?.code || 'PROVIDER_TEST_FAILED', message: 'Provider 测试失败，请查看追踪编号和服务器日志。', traceId, stage: 'request' }
    }
    const saved = this.#persistTestedConfiguration({ actorId: access.user.id, existing, providerId, next, secret, apiKeyProvided: apiKey !== undefined })
    this.logger.info?.('[Provider Test]', { traceId, provider: next.name, model: next.model, stage: 'saved', code: 'PROVIDER_TEST_PASSED', httpStatus: result.httpStatus, protocol: result.protocol, elapsedMs: result.elapsedMs })
    return { ...saved, traceId, stage: 'saved', ...(result.httpStatus ? { httpStatus: result.httpStatus } : {}), ...(result.protocol ? { protocol: result.protocol } : {}), ...(Number.isFinite(result.elapsedMs) ? { elapsedMs: result.elapsedMs } : {}), test: { ok: true } }
  }

  #persistTestedConfiguration({ actorId, existing, providerId, next, secret, apiKeyProvided }) {
    const now = this.clock()
    const config = existing
      ? { ...existing, ...next, encryptedApiKey: apiKeyProvided ? encryptSecret(secret, this.encryptionKey) : existing.encryptedApiKey, updatedAt: now }
      : { id: `provider_${randomUUID()}`, ...next, encryptedApiKey: encryptSecret(secret, this.encryptionKey), enabled: false, createdAt: now, updatedAt: now }
    this.store.transaction(() => {
      this.store.configs.set(config.id, config)
      this.#record(actorId, config, providerId ? 'updated' : 'created')
    })
    return { ok: true, provider: publicConfig(config) }
  }

  getEnabledConfig(kind = 'image') {
    const config = [...this.store.configs.values()].find((candidate) => candidate.enabled && (candidate.kind ?? 'image') === kind)
    if (!config) return { ok: false, code: 'PROVIDER_NOT_AVAILABLE' }
    return {
      ok: true,
      provider: {
        id: config.id,
        name: config.name,
        endpoint: config.endpoint,
        model: config.model,
        kind: config.kind ?? 'image',
        apiKey: decryptSecret(config.encryptedApiKey, this.encryptionKey),
      },
    }
  }

  #authorize(sessionToken) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    if (!this.isAdmin(user)) return { ok: false, code: 'FORBIDDEN' }
    return { ok: true, user }
  }

  #validate({ name, endpoint, model, kind, apiKey }, { requireKey, allowMissingKey = false }) {
    const fields = {}
    for (const field of REQUIRED_TEXT_FIELDS) if (!cleanText({ name, endpoint, model }[field])) fields[field] = `${field} is required`
    if (!PROVIDER_KINDS.has(kind)) fields.kind = 'kind must be image or conversation'
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

export const adminProviderConstants = { MASKED_SECRET, CONFIG_ACTIONS, PROVIDER_KINDS }
