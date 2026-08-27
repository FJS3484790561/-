import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

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

function storedImageBytes(image) {
  const direct = imageBytes(image)
  if (direct) return { bytes: direct, mimeType: image.type ?? image.mimeType }
  const match = String(image?.url ?? '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u)
  return match ? { bytes: Buffer.from(match[2], 'base64'), mimeType: image.mimeType ?? match[1] } : null
}

function imageExtension(mimeType) {
  return mimeType === 'image/png' ? 'png' : 'jpg'
}

function mappedIpv4Address(host) {
  if (!host.startsWith('::ffff:')) return null
  const suffix = host.slice('::ffff:'.length)
  if (suffix.includes('.')) return suffix
  const parts = suffix.split(':')
  if (parts.length !== 2 || parts.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null
  const value = Number.parseInt(parts[0], 16) * 0x10000 + Number.parseInt(parts[1], 16)
  return `${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`
}

function unsafeRemoteHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/u, '')
  if (host === 'localhost' || host === 'localhost.localdomain' || host === '::1' || host === '[::1]') return true
  if (isIP(host) === 6) {
    const normalized = host.replace(/^\[|\]$/gu, '').toLowerCase()
    const mapped = mappedIpv4Address(normalized)
    if (mapped) return unsafeRemoteHost(mapped)
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.') || normalized.startsWith('::ffff:127.')
  }
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  const [first, second] = octets
  return first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}

async function responseBytes(response, maxBytes) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error('Provider image is too large')
    return bytes
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error('Provider image is too large')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, size)
}

async function pinnedHttpsResponse(url, address, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      servername: url.hostname,
      timeout: timeoutMs,
      rejectUnauthorized: true,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('Provider image download timed out')))
    request.on('error', reject)
    request.end()
  })
}

export class MemoryGenerationStore {
  constructor() {
    this.tasks = new Map()
  }

  transaction(work) {
    return work()
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
  constructor({ authService, store = new MemoryGenerationStore(), providers = new ProviderRegistry(), providerName = 'default', clock = () => Date.now(), maxImageBytes = DEFAULT_MAX_IMAGE_BYTES, providerTimeoutMs = 70_000, creditLedger = null, objectStorage = null, fetchImpl = globalThis.fetch, lookupImpl = lookup, logger = console } = {}) {
    if (!authService) throw new Error('authService is required')
    this.authService = authService
    this.store = store
    this.providers = providers
    this.providerName = providerName
    this.clock = clock
    this.maxImageBytes = maxImageBytes
    this.providerTimeoutMs = providerTimeoutMs
    this.creditLedger = creditLedger
    this.objectStorage = objectStorage
    this.fetchImpl = fetchImpl
    this.lookupImpl = lookupImpl
    this.logger = logger
  }

  createGeneration({ sessionToken, image, params }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return Promise.resolve(error('UNAUTHORIZED'))
    const validation = validateRequest({ image, params }, this.maxImageBytes)
    if (validation) return Promise.resolve(validation)
    const id = `generation_${randomUUID()}`
    const task = { id, traceId: id, userId: user.id, status: 'queued', createdAt: this.clock(), updatedAt: this.clock(), input: { name: image.name ?? 'upload', type: image.type, size: imageBytes(image).length }, params: { ...params, preferences: { ...(params.preferences ?? {}) } } }
    let reservation
    try {
      const prepared = this.store.transaction(() => {
        reservation = this.creditLedger?.reserveForUser({ userId: user.id, operationId: id, amount: 1 })
        if (reservation && !reservation.ok) return reservation
        if (reservation) task.reservationId = reservation.reservation.id
        this.store.tasks.set(id, task)
        return { ok: true }
      })
      if (!prepared.ok) return Promise.resolve(prepared)
    } catch {
      if (reservation?.ok) this.creditLedger?.releaseForUser({ userId: user.id, reservationId: reservation.reservation.id })
      return Promise.resolve(error('GENERATION_PERSISTENCE_FAILED'))
    }
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
    while (true) {
      const task = this.store.tasks.get(taskId)
      if (!task) return null
      if (task.status !== 'queued' && task.status !== 'running') return this.#publicTask(task)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  async #run(task, image) {
    task.status = 'running'
    task.updatedAt = this.clock()
    this.store.tasks.set(task.id, task)
    this.logger.info?.('[Generation]', { traceId: task.traceId, stage: 'started' })
    const provider = this.providers.get(this.providerName)
    if (!provider) return this.#fail(task, { code: 'PROVIDER_UNAVAILABLE' })
    let timeoutId
    try {
      if (this.objectStorage) {
        const original = storedImageBytes(image)
        const stored = await this.#storeImage(task, 'original', original)
        task.input = { ...task.input, objectKey: stored.key, url: this.#objectUrl(stored.key) }
        this.store.tasks.set(task.id, task)
        this.logger.info?.('[Generation]', { traceId: task.traceId, stage: 'original-stored' })
      }
      const output = await Promise.race([
        provider.generate({ image, params: task.params, traceId: task.traceId }),
        new Promise((_, reject) => { timeoutId = setTimeout(() => reject({ code: 'PROVIDER_TIMEOUT' }), this.providerTimeoutMs) }),
      ])
      clearTimeout(timeoutId)
      if (!output?.effectImage?.url) return this.#fail(task, { code: 'INVALID_PROVIDER_RESPONSE' })
      let effectImage = { url: String(output.effectImage.url), mimeType: output.effectImage.mimeType ?? 'image/jpeg' }
      if (this.objectStorage) {
        const result = await this.#providerImageBytes(output.effectImage)
        const stored = await this.#storeImage(task, 'result', result)
        effectImage = { url: this.#objectUrl(stored.key), objectKey: stored.key, mimeType: stored.mimeType }
        this.logger.info?.('[Generation]', { traceId: task.traceId, stage: 'result-stored' })
      }
      this.store.transaction(() => {
        const settlement = this.creditLedger?.settleForUser({ userId: task.userId, reservationId: task.reservationId })
        if (settlement && !settlement.ok) {
          const settlementError = new Error('Credit settlement failed')
          settlementError.code = 'CREDIT_SETTLEMENT_FAILED'
          throw settlementError
        }
        task.status = 'succeeded'
        task.result = { original: { ...task.input }, effectImage }
        task.updatedAt = this.clock()
        this.store.tasks.set(task.id, task)
      })
      this.logger.info?.('[Generation]', { traceId: task.traceId, stage: 'succeeded', code: 'GENERATION_SUCCEEDED' })
    } catch (reason) {
      clearTimeout(timeoutId)
      this.logger.error?.('[Generation]', { traceId: task.traceId, stage: reason?.stage ?? (reason?.code === 'PROVIDER_TIMEOUT' ? 'timeout' : 'failed'), code: reason?.code ?? 'PROVIDER_UNAVAILABLE', ...(reason?.httpStatus ? { httpStatus: reason.httpStatus } : {}) })
      this.#fail(task, safeFailure(reason))
    }
  }

  #fail(task, reason) {
    this.store.transaction(() => {
      if (this.creditLedger && task.reservationId) this.creditLedger.releaseForUser({ userId: task.userId, reservationId: task.reservationId })
      task.status = 'failed'
      task.error = { code: reason.code, message: reason.message ?? '暂时无法生成设计，请稍后重试。' }
      task.updatedAt = this.clock()
      this.store.tasks.set(task.id, task)
    })
  }

  #publicTask(task) {
    return { id: task.id, traceId: task.traceId ?? task.id, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt, input: task.input, ...(task.status === 'succeeded' ? { result: task.result } : {}), ...(task.status === 'failed' ? { error: task.error } : {}) }
  }

  async #storeImage(task, kind, image) {
    if (!image?.bytes || !image.mimeType) throw new Error('Image bytes are required for object storage')
    const key = `users/${task.userId}/generations/${task.id}/${kind}.${imageExtension(image.mimeType)}`
    return this.objectStorage.put({ key, body: image.bytes, mimeType: image.mimeType, ownerId: task.userId, metadata: { kind, generationId: task.id } })
  }

  async #providerImageBytes(image) {
    const direct = storedImageBytes(image)
    if (direct) return direct
    let url
    try {
      url = new URL(String(image?.url))
    } catch {
      throw new Error('Provider image URL is invalid')
    }
    if (url.protocol !== 'https:' || url.username || url.password || unsafeRemoteHost(url.hostname) || typeof this.fetchImpl !== 'function') throw new Error('Provider image bytes are unavailable')
    let resolvedAddress = null
    if (!isIP(url.hostname)) {
      let addresses
      try {
        addresses = await this.lookupImpl(url.hostname, { all: true, verbatim: true })
      } catch {
        throw new Error('Provider image address is unavailable')
      }
      if (!addresses.length || addresses.some(({ address }) => unsafeRemoteHost(address))) throw new Error('Provider image address is unsafe')
      resolvedAddress = addresses[0]
    }
    const response = this.fetchImpl === globalThis.fetch && resolvedAddress
      ? await pinnedHttpsResponse(url, resolvedAddress, this.providerTimeoutMs)
      : await this.fetchImpl(url, { signal: AbortSignal.timeout(this.providerTimeoutMs), redirect: 'error' })
    if (!response.ok) throw new Error('Provider image download failed')
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > this.maxImageBytes) throw new Error('Provider image is too large')
    const bytes = await responseBytes(response, this.maxImageBytes)
    const mimeType = image.mimeType ?? response.headers.get('content-type')?.split(';')[0]
    if (!ALLOWED_IMAGE_TYPES.has(mimeType) || bytes.length === 0 || bytes.length > this.maxImageBytes || !matchesImageSignature(mimeType, bytes)) throw new Error('Provider image content is invalid')
    return { bytes, mimeType }
  }

  #objectUrl(key) {
    return `/api/objects/${encodeURIComponent(key)}`
  }
}

export const generationConstants = { DEFAULT_MAX_IMAGE_BYTES, ALLOWED_IMAGE_TYPES, ALLOWED_ROOMS, ALLOWED_THEMES, ALLOWED_SCALES }
