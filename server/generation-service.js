import { randomUUID } from 'node:crypto'

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])
const ALLOWED_ROOMS = new Set(['客厅', '卧室', '餐厅', '厨房', '书房'])
const ALLOWED_THEMES = new Set(['现代简约', '北欧', '日式', '奶油风', '原木风', '轻奢'])
const ALLOWED_SCALES = new Set(['保真', '均衡', '创意', '大胆'])
const ALLOWED_PREFERENCES = new Set(['layout', 'storage', 'light'])

const error = (code, fields = undefined) => ({ ok: false, code, ...(fields ? { fields } : {}) })

function imageBytes(image) {
  if (Buffer.isBuffer(image?.data)) return image.data
  if (image?.data instanceof Uint8Array) return Buffer.from(image.data)
  return null
}

function matchesImageSignature(type, bytes) {
  if (!bytes) return false
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (type === 'image/png') return bytes.length >= 8 && Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).equals(bytes.subarray(0, 8))
  return false
}

function validateRequest({ image, params }, maxImageBytes) {
  const fields = {}
  const bytes = imageBytes(image)
  if (!image || !ALLOWED_IMAGE_TYPES.has(image.type)) fields.image = '仅支持 JPEG 或 PNG 图片。'
  else if (!bytes || !matchesImageSignature(image.type, bytes)) fields.image = '图片内容与文件类型不匹配。'
  else if (bytes.length === 0 || bytes.length > maxImageBytes) fields.image = `图片大小需在 1 字节到 ${maxImageBytes} 字节之间。`

  if (!ALLOWED_ROOMS.has(params?.room)) fields.room = '请选择有效的空间类型。'
  if (!ALLOWED_THEMES.has(params?.theme)) fields.theme = '请选择有效的设计风格。'
  if (!ALLOWED_SCALES.has(params?.scale)) fields.scale = '请选择有效的改造强度。'
  if (params?.preferences && (typeof params.preferences !== 'object' || Object.keys(params.preferences).some((key) => !ALLOWED_PREFERENCES.has(key) || typeof params.preferences[key] !== 'boolean'))) fields.preferences = '固定偏好格式无效。'
  return Object.keys(fields).length ? error('VALIDATION_ERROR', fields) : null
}

function safeFailure(reason) {
  if (reason?.code === 'PROVIDER_TIMEOUT') return { code: 'GENERATION_TIMEOUT', message: '生成时间较长，请稍后重试。' }
  return { code: 'PROVIDER_UNAVAILABLE', message: '暂时无法生成设计，请稍后重试。' }
}

export class MemoryGenerationStore {
  constructor() {
    this.tasks = new Map()
  }
}

export class ProviderRegistry {
  constructor(providers = {}) {
    this.providers = new Map(Object.entries(providers))
  }

  register(name, provider) {
    this.providers.set(name, provider)
  }

  get(name) {
    return this.providers.get(name)
  }
}

export class GenerationService {
  constructor({ authService, store = new MemoryGenerationStore(), providers = new ProviderRegistry(), providerName = 'default', clock = () => Date.now(), maxImageBytes = DEFAULT_MAX_IMAGE_BYTES, providerTimeoutMs = 30_000, creditLedger = null } = {}) {
    if (!authService) throw new Error('authService is required')
    this.authService = authService
    this.store = store
    this.providers = providers
    this.providerName = providerName
    this.clock = clock
    this.maxImageBytes = maxImageBytes
    this.providerTimeoutMs = providerTimeoutMs
    this.creditLedger = creditLedger
  }

  createGeneration({ sessionToken, image, params }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return Promise.resolve(error('UNAUTHORIZED'))
    const validation = validateRequest({ image, params }, this.maxImageBytes)
    if (validation) return Promise.resolve(validation)
    const id = `generation_${randomUUID()}`
    const reservation = this.creditLedger?.reserveForUser({ userId: user.id, operationId: id, amount: 1 })
    if (reservation && !reservation.ok) return Promise.resolve(reservation)
    const task = { id, userId: user.id, status: 'queued', createdAt: this.clock(), updatedAt: this.clock(), input: { name: image.name ?? 'upload', type: image.type, size: imageBytes(image).length }, params: { ...params, preferences: { ...(params.preferences ?? {}) } } }
    if (reservation) task.reservationId = reservation.reservation.id
    this.store.tasks.set(id, task)
    queueMicrotask(() => this.#run(task, image))
    return Promise.resolve({ ok: true, task: this.#publicTask(task) })
  }

  getGeneration({ sessionToken, taskId }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return error('UNAUTHORIZED')
    const task = this.store.tasks.get(taskId)
    if (!task || task.userId !== user.id) return error('NOT_FOUND')
    return { ok: true, task: this.#publicTask(task) }
  }

  async waitForGeneration(taskId) {
    const task = this.store.tasks.get(taskId)
    if (!task) return null
    while (task.status === 'queued' || task.status === 'running') await new Promise((resolve) => setTimeout(resolve, 0))
    return this.#publicTask(task)
  }

  async #run(task, image) {
    task.status = 'running'
    task.updatedAt = this.clock()
    const provider = this.providers.get(this.providerName)
    if (!provider) return this.#fail(task, { code: 'PROVIDER_UNAVAILABLE' })
    let timeoutId
    try {
      const output = await Promise.race([
        provider.generate({ image, params: task.params }),
        new Promise((_, reject) => { timeoutId = setTimeout(() => reject({ code: 'PROVIDER_TIMEOUT' }), this.providerTimeoutMs) }),
      ])
      clearTimeout(timeoutId)
      if (!output?.effectImage?.url) return this.#fail(task, { code: 'INVALID_PROVIDER_RESPONSE' })
      task.status = 'succeeded'
      const settlement = this.creditLedger?.settleForUser({ userId: task.userId, reservationId: task.reservationId })
      if (settlement && !settlement.ok) return this.#fail(task, { code: 'CREDIT_SETTLEMENT_FAILED' })
      task.result = { original: { ...task.input }, effectImage: { url: String(output.effectImage.url), mimeType: output.effectImage.mimeType ?? 'image/jpeg' } }
      task.updatedAt = this.clock()
    } catch (reason) {
      clearTimeout(timeoutId)
      this.#fail(task, safeFailure(reason))
    }
  }

  #fail(task, reason) {
    if (this.creditLedger && task.reservationId) this.creditLedger.releaseForUser({ userId: task.userId, reservationId: task.reservationId })
    task.status = 'failed'
    task.error = { code: reason.code, message: reason.message ?? '暂时无法生成设计，请稍后重试。' }
    task.updatedAt = this.clock()
  }

  #publicTask(task) {
    return { id: task.id, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt, input: task.input, ...(task.status === 'succeeded' ? { result: task.result } : {}), ...(task.status === 'failed' ? { error: task.error } : {}) }
  }
}

export const generationConstants = { DEFAULT_MAX_IMAGE_BYTES, ALLOWED_IMAGE_TYPES, ALLOWED_ROOMS, ALLOWED_THEMES, ALLOWED_SCALES }
