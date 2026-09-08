import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const DEFAULT_PROVIDER_TIMEOUT_MS = 110_000
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])
const ALLOWED_ROOMS = new Set(['客厅', '卧室', '餐厅', '厨房', '书房'])
const ALLOWED_THEMES = new Set(['现代简约', '北欧', '日式', '奶油风', '原木风', '轻奢', '中古风', '侘寂风', '自定义'])
const ALLOWED_SCALES = new Set()

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
  for (const field of ['userPrompt', 'editPrompt', 'customStylePrompt']) {
    if (params?.[field] !== undefined && (typeof params[field] !== 'string' || params[field].length > 2000)) fields[field] = '描述请控制在 2000 字以内。'
  }
  if (params?.styleReference && (!ALLOWED_IMAGE_TYPES.has(params.styleReference.type) || !matchesImageSignature(params.styleReference.type, imageBytes(params.styleReference)) || imageBytes(params.styleReference).length > maxImageBytes)) fields.styleReference = '风格参考图无效。'
  return Object.keys(fields).length ? error('VALIDATION_ERROR', fields) : null
}

function safeFailure(reason) {
  if (reason?.code === 'PROVIDER_TIMEOUT') return { code: 'GENERATION_TIMEOUT', message: '生成时间较长，请稍后重试。' }
  if (reason?.code === 'RESULT_DOWNLOAD_FAILED') return { code: 'RESULT_DOWNLOAD_FAILED', message: '生成结果保存失败，本次不会扣除额度。' }
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
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [{ address: address.address, family: address.family }])
        else callback(null, address.address, address.family)
      },
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
  constructor({ authService, store = new MemoryGenerationStore(), providers = new ProviderRegistry(), providerName = 'default', clock = () => Date.now(), maxImageBytes = DEFAULT_MAX_IMAGE_BYTES, providerTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS, creditLedger = null, objectStorage = null, fetchImpl = globalThis.fetch, lookupImpl = lookup, logger = console } = {}) {
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

  async createRevision({ sessionToken, taskId, prompt, styleReference }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return error('UNAUTHORIZED')
    const parent = this.store.tasks.get(taskId)
    if (!parent || parent.userId !== user.id) return error('NOT_FOUND')
    if (parent.status !== 'succeeded' || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) return error('VALIDATION_ERROR')
    try {
      const result = parent.result.effectImage
      let bytes
      let type
      if (result.objectKey && this.objectStorage) {
        const metadata = this.objectStorage.metadataFor(result.objectKey)
        if (!metadata || metadata.ownerId !== user.id) return error('NOT_FOUND')
        const stored = await this.objectStorage.get({ key: result.objectKey })
        bytes = Buffer.from(stored.body)
        type = metadata.mimeType
      } else {
        const stored = storedImageBytes(result)
        if (!stored) return error('REVISION_SOURCE_UNAVAILABLE')
        bytes = stored.bytes; type = stored.mimeType
      }
      return this.#create({ sessionToken, image: { data: bytes, type, name: 'current-result', width: parent.input.width, height: parent.input.height }, params: { ...parent.params, styleReference, editPrompt: prompt.trim() } }, parent)
    } catch {
      return error('REVISION_SOURCE_UNAVAILABLE')
    }
  }

  createGeneration(request) {
    // Revision semantics can only be selected through the owner-checked revision endpoint.
    const params = { ...request.params }
    delete params.editPrompt
    return this.#create({ ...request, params })
  }

  #create({ sessionToken, image, params }, parent = null) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return Promise.resolve(error('UNAUTHORIZED'))
    const validation = validateRequest({ image, params }, this.maxImageBytes)
    if (validation) return Promise.resolve(validation)
    const id = `generation_${randomUUID()}`
    const dimensions = Number.isFinite(image.width) && Number.isFinite(image.height) ? { width: image.width, height: image.height } : {}
    const task = { id, traceId: id, userId: user.id, status: 'queued', createdAt: this.clock(), updatedAt: this.clock(), input: { name: image.name ?? 'upload', type: image.type, size: imageBytes(image).length, ...dimensions }, params: { ...params, ...(params.styleReference ? { styleReference: { type: params.styleReference.type, size: imageBytes(params.styleReference)?.length ?? 0 } } : {}) } }
    if (parent) {
      task.parentTaskId = parent.id
      task.rootTaskId = parent.rootTaskId ?? parent.id
      task.originalRoom = parent.originalRoom ?? parent.result.original
    }
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
    queueMicrotask(() => this.#run(task, image, params.styleReference))
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

  async #run(task, image, styleReference) {
    const serverStartedAt = Date.now()
    task.timings = { queuedMs: Math.max(0, this.clock() - task.createdAt) }
    task.status = 'running'
    task.updatedAt = this.clock()
    this.store.tasks.set(task.id, task)
    this.logger.info?.('[Generation]', { traceId: task.traceId, stage: 'started' })
    const provider = this.providers.get(this.providerName)
    if (!provider) return this.#fail(task, { code: 'PROVIDER_UNAVAILABLE' })
    let timeoutId
    let providerStartedAt
    try {
      if (this.objectStorage) {
        const originalStoreStartedAt = Date.now()
        const original = storedImageBytes(image)
        const stored = await this.#storeImage(task, 'original', original)
        task.timings.originalStoreMs = Date.now() - originalStoreStartedAt
        task.input = { ...task.input, objectKey: stored.key, url: this.#objectUrl(stored.key) }
        this.store.tasks.set(task.id, task)
        this.logger.info?.('[Generation]', { traceId: task.traceId, stage: 'original-stored', elapsedMs: task.timings.originalStoreMs })
      }
      providerStartedAt = Date.now()
      const output = await Promise.race([
        provider.generate({ image, params: { ...task.params, styleReference }, traceId: task.traceId }),
        new Promise((_, reject) => { timeoutId = setTimeout(() => reject({ code: 'PROVIDER_TIMEOUT' }), this.providerTimeoutMs) }),
      ])
      clearTimeout(timeoutId)
      task.timings.providerCallMs = Date.now() - providerStartedAt
      task.timings.providerMs = Number.isFinite(output?.timings?.providerMs) ? output.timings.providerMs : task.timings.providerCallMs
      if (!output?.effectImage?.url) throw { code: 'INVALID_PROVIDER_RESPONSE' }
      let effectImage = { url: String(output.effectImage.url), mimeType: output.effectImage.mimeType ?? 'image/jpeg' }
      if (this.objectStorage) {
        const resultStoreStartedAt = Date.now()
        let result
        try {
          const resultDownloadStartedAt = Date.now()
          result = await this.#providerImageBytes(output.effectImage)
          task.timings.resultDownloadMs = Date.now() - resultDownloadStartedAt
        } catch (reason) {
          const failure = reason instanceof Error ? reason : new Error('Provider result download failed')
          failure.code = 'RESULT_DOWNLOAD_FAILED'
          failure.stage = 'result-download'
          throw failure
        }
        const resultUploadStartedAt = Date.now()
        const stored = await this.#storeImage(task, 'result', result)
        task.timings.resultUploadMs = Date.now() - resultUploadStartedAt
        task.timings.resultStoreMs = Date.now() - resultStoreStartedAt
        effectImage = { url: this.#objectUrl(stored.key), objectKey: stored.key, mimeType: stored.mimeType }
        this.logger.info?.('[Generation]', { traceId: task.traceId, stage: 'result-stored', elapsedMs: task.timings.resultStoreMs })
      }
      const creditSettlementStartedAt = Date.now()
      this.store.transaction(() => {
        const settlement = this.creditLedger?.settleForUser({ userId: task.userId, reservationId: task.reservationId })
        if (settlement && !settlement.ok) {
          const settlementError = new Error('Credit settlement failed')
          settlementError.code = 'CREDIT_SETTLEMENT_FAILED'
          throw settlementError
        }
        task.status = 'succeeded'
        task.result = { original: { ...(task.originalRoom ?? task.input) }, effectImage }
        task.updatedAt = this.clock()
        this.store.tasks.set(task.id, task)
      })
      task.timings.creditSettlementMs = Date.now() - creditSettlementStartedAt
      task.timings.serverTotalMs = Date.now() - serverStartedAt
      task.timings.nonProviderMs = Math.max(0, task.timings.serverTotalMs - task.timings.providerCallMs)
      this.store.tasks.set(task.id, task)
      this.logger.info?.('[Generation Timing]', { traceId: task.traceId, ...task.timings })
      this.logger.info?.('[Generation]', { traceId: task.traceId, stage: 'succeeded', code: 'GENERATION_SUCCEEDED' })
    } catch (reason) {
      clearTimeout(timeoutId)
      task.timings.serverTotalMs = Date.now() - serverStartedAt
      if (!Number.isFinite(task.timings.providerCallMs)) task.timings.providerCallMs = providerStartedAt ? Date.now() - providerStartedAt : 0
      if (!Number.isFinite(task.timings.providerMs)) task.timings.providerMs = task.timings.providerCallMs
      task.timings.nonProviderMs = Math.max(0, task.timings.serverTotalMs - task.timings.providerCallMs)
      this.logger.info?.('[Generation Timing]', { traceId: task.traceId, ...task.timings })
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
    return { id: task.id, traceId: task.traceId ?? task.id, status: task.status, parentTaskId: task.parentTaskId ?? null, rootTaskId: task.rootTaskId ?? task.id, createdAt: task.createdAt, updatedAt: task.updatedAt, input: task.input, ...(task.timings ? { timings: { ...task.timings } } : {}), ...(task.status === 'succeeded' ? { result: task.result } : {}), ...(task.status === 'failed' ? { error: task.error } : {}) }
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
