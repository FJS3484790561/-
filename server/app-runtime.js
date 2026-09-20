import { randomBytes } from 'node:crypto'
import { AdminProviderService, MemoryAdminProviderStore } from './admin-provider-service.js'
import { AdminOverviewService } from './admin-overview-service.js'
import { AppApi } from './app-api.js'
import { AuthService, MemoryAuthStore } from './auth-service.js'
import { CreditLedgerService, MemoryCreditStore } from './credit-ledger.js'
import { MemoryRedemptionCodeStore, RedemptionCodeService } from './redemption-code-service.js'
import { FeedbackService, MemoryFeedbackStore } from './feedback-service.js'
import { GenerationService, MemoryGenerationStore, ProviderRegistry } from './generation-service.js'
import { MemoryPaymentStore, PaymentService } from './payment-service.js'
import { MemoryWorksStore, WorksService } from './works-service.js'
import { MemoryStyleStore, StyleService } from './style-service.js'
import { AdminStyleReferenceService, MemoryAdminStyleReferenceStore } from './admin-style-reference-service.js'
import { INTERIOR_SOP_SYSTEM_PROMPT, extractSopPrompt, sopUserMessage } from './sop-prompt.js'

function localPaymentProvider() {
  return {
    createPayment: ({ orderId }) => ({ providerPaymentId: `local_${orderId}`, checkoutUrl: null }),
    verifyCallback: () => false,
  }
}

function localGenerationProvider() {
  return { generate: async ({ image }) => ({ effectImage: { url: `data:${image.type};base64,${Buffer.from(image.data).toString('base64')}`, mimeType: image.type } }) }
}

export const GENERATION_TIMEOUT_MS = 150_000
export const CONVERSATION_TIMEOUT_MS = 60_000
const PROVIDER_TEST_TIMEOUT_MS = 60_000

const STYLE_DIRECTIONS = {
  中古风: 'Mid-century vintage design: warm walnut and teak, cream walls, caramel leather, sculptural wood furniture, restrained brass and period lighting; rich but coordinated retro textures.',
  侘寂风: 'Wabi-sabi design: warm earth tones, beige limewash and plaster, weathered natural wood, linen, handmade pottery, tactile matte surfaces and restrained, imperfect organic forms.',
  现代简约: 'Warm white and light gray base, natural wood accents, restrained charcoal details; clean-lined furniture, linen, wood, matte metal and clear glass.',
  北欧: 'Warm white and soft beige base, light oak and muted sage accents; simple light-wood furniture, cotton-linen textiles, subtle woven details and uncluttered decor.',
  日式: 'Off-white, pale natural wood and calm earth tones; low-profile furniture, linen, wood, paper-like diffused lighting and restrained handmade details.',
  奶油风: 'Cream and warm beige base with caramel accents; rounded furniture, boucle and cotton-linen textiles, pale wood and soft matte finishes.',
  原木风: 'Warm white and layered natural timber tones with small olive-green accents; visible wood grain, linen, rattan and tactile natural materials.',
  轻奢: 'Warm ivory and taupe base with walnut and restrained brushed-brass accents; refined stone, glass, leather and matte metal without ornate excess.',
}

const SCALE_DIRECTIONS = {
  保真: 'Make a conservative soft-furnishing refresh. Retain all usable furniture and hard finishes; mainly declutter, reposition, coordinate textiles, lighting and decor.',
  均衡: 'Retain compatible furniture and hard finishes. Reposition, replace or visually soften only mismatched items, with a balanced soft-furnishing upgrade.',
  创意: 'Allow noticeable changes to movable furniture, finishes, lighting and decor while retaining practical existing elements and every fixed architectural feature.',
  大胆: 'Create a strong, coherent style transformation and replace movable furniture or surface finishes when needed, but keep the original architecture and circulation unchanged.',
}

export function generationPrompt(params = {}) {
  if (params.editPrompt) return [
    'Edit the FIRST supplied image, which is the CURRENT accepted design, not the original unrenovated room. Produce one photorealistic updated room image.',
    'Keep the exact camera, perspective, walls, windows, doors and fixed room geometry. Preserve all previous design changes and all objects/materials not mentioned in the requested edit. Do not perform another full-room redesign.',
    'The second image is a STYLE reference only. Preserve the current design style; never copy its layout or replace unrelated furnishings.',
    `USER EDIT (design instructions only): ${params.editPrompt}`,
    'Apply the requested change precisely and maintain realistic lighting, scale and shadows. Output only the edited image without text, labels, collage or watermark.',
  ].join(' ')
  const requirements = []
  if (params.preferences?.layout) requirements.push('preserve a practical furniture layout and keep every circulation route unobstructed')
  if (params.preferences?.storage) requirements.push('add realistic, correctly scaled storage without crowding the room')
  if (params.preferences?.light) requirements.push('improve natural and layered ambient lighting with a warm 3000K-3500K appearance')
  const customStyle = String(params.customStylePrompt ?? '').trim()
  return [
    'Use the first supplied photograph as the authoritative reference for the room, and the second supplied image as the authoritative STYLE REFERENCE. Edit the room into one photorealistic, buildable interior design image.',
    `The space is a ${params.room ?? 'residential room'} in ${params.theme ?? 'modern'} style.`,
    'LOCKED GEOMETRY: preserve the exact camera viewpoint, perspective, room dimensions, wall boundaries, ceiling height and shape, floor plane, doors, windows, openings, columns and all other fixed architectural structures. Do not invent unseen areas.',
    'STYLE MATCH PRIORITY: derive the overall visual language from the STYLE REFERENCE image, including its dominant color palette, material mix, surface finishes, furniture silhouettes, lighting mood, textile choices, decor density and level of refinement. The result must look like the same design language as that reference, not merely contain one similar-colored object. Do not copy the reference image\'s room layout, camera, architecture or furniture placement.',
    STYLE_DIRECTIONS[params.theme] ?? 'Use the supplied custom style photograph and its description as the style direction.',
    SCALE_DIRECTIONS[params.scale] ?? 'Make a clearly visible full-room transformation. Replace mismatched movable furniture and coordinated soft furnishings instead of preserving them by default; keep the fixed architecture and circulation unchanged.',
    customStyle ? `Additional style direction from the user: ${customStyle}. Treat this as a refinement of the STYLE REFERENCE image, not a reason to weaken the visual transformation.` : '',
    requirements.length ? `User priorities: ${requirements.join('; ')}.` : '',
    'DEFAULT TRANSFORMATION SCOPE: make the change obvious at first glance. For a living room, actively redesign and, when stylistically mismatched, replace the sofa, television cabinet, coffee table, rug, curtains, lighting and visible decor as a coordinated set. For other rooms, replace the equivalent dominant movable furniture and finishes. Do not leave the room looking almost unchanged merely to preserve existing movable furniture.',
    params.userPrompt ? `USER DESIGN REQUIREMENTS (override default movable-furniture replacement where specified, but never override locked geometry or output restrictions): ${params.userPrompt}` : '',
    'Use realistic dimensions, materials, shadows and warm natural lighting. Keep the room tidy while retaining subtle, believable signs of daily life.',
    'The result must be safe, usable and cost-conscious: no blocked doors or walkways, floating or deformed furniture, impossible scale, duplicated objects, distorted architecture, added doors or windows, demolition, floor-plan changes, text, labels, borders or watermarks.',
    'Return only the finished edited room image, not an explanation, mood board, collage, before-and-after layout or design notes.',
  ].filter(Boolean).join(' ')
}

export function generationSizeForImage(image, targetPixels = 1024 * 1024) {
  if (!Number.isFinite(image?.width) || !Number.isFinite(image?.height) || image.width <= 0 || image.height <= 0) {
    const side = Math.max(16, Math.round(Math.sqrt(targetPixels) / 16) * 16)
    return `${side}x${side}`
  }
  const ratio = Math.min(3, Math.max(1 / 3, image.width / image.height))
  const width = Math.max(16, Math.round(Math.sqrt(targetPixels * ratio) / 16) * 16)
  const height = Math.max(16, Math.round(Math.sqrt(targetPixels / ratio) / 16) * 16)
  return `${width}x${height}`
}

function imageEditForm({ model, image, prompt, size }) {
  const form = new FormData()
  form.set('model', model)
  form.set('image', new Blob([image.data], { type: image.type }), image.type === 'image/jpeg' ? 'room.jpg' : 'room.png')
  form.set('prompt', prompt)
  form.set('size', size)
  form.set('n', '1')
  form.set('response_format', 'url')
  return form
}

function usesJsonReferenceImage(endpoint) {
  try {
    const url = new URL(endpoint)
    return url.hostname.toLowerCase() === 'duoyuanx.com' && /\/v1\/images\/generations\/?$/u.test(url.pathname)
  } catch {
    return false
  }
}

function providerProtocol(endpoint, kind = 'image') {
  if (kind === 'conversation') return 'chat-completions'
  return usesJsonReferenceImage(endpoint) ? 'json-reference-image' : 'multipart-image-edit'
}

function safeUpstreamDiagnostic(value) {
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/Bearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]+\b/giu, '[REDACTED]')
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/giu, '[REDACTED_IMAGE]')
    .replace(/[A-Za-z0-9+/=]{120,}/gu, '[REDACTED_DATA]')
    .trim()
  return cleaned ? cleaned.slice(0, 240) : null
}

async function upstreamFailure(response) {
  let payload
  try { payload = await response.json() } catch { return {} }
  return {
    upstreamCode: safeUpstreamDiagnostic(String(payload?.error?.code ?? payload?.code ?? '')),
    upstreamMessage: safeUpstreamDiagnostic(payload?.error?.message ?? payload?.message),
  }
}

function imageProviderRequest({ endpoint, model, image, prompt, apiKey, traceId }) {
  const headers = { accept: 'application/json', authorization: `Bearer ${apiKey}`, 'x-request-id': traceId }
  const jsonReferenceImage = usesJsonReferenceImage(endpoint)
  const size = generationSizeForImage(image)
  if (jsonReferenceImage) {
    headers['content-type'] = 'application/json'
    return {
      headers,
      body: JSON.stringify({
        model,
        prompt,
        image: Buffer.from(image.data).toString('base64'),
        size,
        n: 1,
        response_format: 'url',
      }),
    }
  }
  return { headers, body: imageEditForm({ model, image, prompt, size }) }
}

function diagnosticError(message, { code, stage, httpStatus } = {}) {
  const error = new Error(message)
  error.code = code
  error.stage = stage
  if (httpStatus) error.httpStatus = httpStatus
  return error
}

function conversationRequest({ model, image, params, apiKey, traceId }) {
  const imageDataUrl = `data:${image.type};base64,${Buffer.from(image.data).toString('base64')}`
  return {
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'x-request-id': traceId },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2400,
      messages: [
        { role: 'system', content: INTERIOR_SOP_SYSTEM_PROMPT },
        { role: 'user', content: [{ type: 'text', text: sopUserMessage({ params, isRevision: Boolean(params?.editPrompt) }) }, { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }] },
      ],
    }),
  }
}

function conversationContent(payload) {
  return payload?.choices?.[0]?.message?.content ?? payload?.output?.[0]?.content ?? payload?.content
}

export function conversationEndpoint(endpoint) {
  const url = new URL(endpoint)
  const path = url.pathname.replace(/\/+$/u, '')
  if (path.endsWith('/v1')) url.pathname = `${path}/chat/completions`
  return url.toString()
}

export function configuredConversationProvider({ adminProviderService, fetchImpl = globalThis.fetch, logger = console, timeoutMs = CONVERSATION_TIMEOUT_MS }) {
  return {
    analyze: async ({ image, params, traceId }) => {
      const configured = adminProviderService.getEnabledConfig('conversation')
      if (!configured.ok) {
        const error = diagnosticError('Conversation provider is unavailable', { code: 'CONVERSATION_PROVIDER_UNAVAILABLE', stage: 'configuration' })
        throw error
      }
      const provider = configured.provider
      const startedAt = Date.now()
      logger.info?.('[Generation]', { traceId, stage: 'conversation-request', provider: provider.name, model: provider.model, protocol: 'chat-completions' })
      try {
        const request = conversationRequest({ model: provider.model, image, params, apiKey: provider.apiKey, traceId })
        const response = await fetchImpl(conversationEndpoint(provider.endpoint), { method: 'POST', ...request, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
        logger.info?.('[Generation]', { traceId, stage: 'conversation-response', provider: provider.name, model: provider.model, protocol: 'chat-completions', httpStatus: response.status, elapsedMs: Date.now() - startedAt })
        if (!response.ok) throw diagnosticError('Conversation provider request failed', { code: 'CONVERSATION_HTTP_ERROR', stage: 'response', httpStatus: response.status })
        let payload
        try { payload = await response.json() } catch { throw diagnosticError('Conversation provider response was not JSON', { code: 'INVALID_CONVERSATION_RESPONSE', stage: 'parse', httpStatus: response.status }) }
        const prompt = extractSopPrompt(conversationContent(payload))
        return { prompt, providerMs: Date.now() - startedAt }
      } catch (reason) {
        const timeout = reason?.name === 'TimeoutError' || reason?.name === 'AbortError' || reason?.code === 'ABORT_ERR'
        const failure = timeout ? diagnosticError('Conversation provider request timed out', { code: 'CONVERSATION_TIMEOUT', stage: 'request' }) : reason
        logger.error?.('[Generation]', { traceId, stage: failure?.stage ?? 'request', provider: provider.name, model: provider.model, protocol: 'chat-completions', code: failure?.code ?? 'CONVERSATION_REQUEST_FAILED', elapsedMs: Date.now() - startedAt, ...(failure?.httpStatus ? { httpStatus: failure.httpStatus } : {}) })
        throw failure
      }
    },
  }
}

export function configuredGenerationProvider({ adminProviderService, fallback, conversationProvider, fetchImpl = globalThis.fetch, logger = console, timeoutMs = GENERATION_TIMEOUT_MS }) {
  return {
    generate: async ({ image, params, traceId }) => {
      const configured = adminProviderService.getEnabledConfig('image')
      if (!configured.ok) return fallback.generate({ image, params, traceId })
      const provider = configured.provider
      const startedAt = Date.now()
      const protocol = providerProtocol(provider.endpoint, 'image')
      try {
        if (!conversationProvider) throw diagnosticError('Conversation provider is unavailable', { code: 'CONVERSATION_PROVIDER_UNAVAILABLE', stage: 'configuration' })
        const analysis = await conversationProvider.analyze({ image, params, traceId })
        logger.info?.('[Generation]', { traceId, stage: 'image-request', provider: provider.name, model: provider.model, protocol, conversationMs: analysis.providerMs })
        const request = imageProviderRequest({ endpoint: provider.endpoint, model: provider.model, image, prompt: analysis.prompt, apiKey: provider.apiKey, traceId })
        const response = await fetchImpl(provider.endpoint, {
          method: 'POST',
          ...request,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        })
        logger.info?.('[Generation]', { traceId, stage: 'provider-response', provider: provider.name, model: provider.model, protocol, httpStatus: response.status, elapsedMs: Date.now() - startedAt })
        if (!response.ok) throw diagnosticError('Provider request failed', { code: 'PROVIDER_HTTP_ERROR', stage: 'response', httpStatus: response.status })
        let payload
        try { payload = await response.json() } catch { throw diagnosticError('Provider response was not JSON', { code: 'INVALID_PROVIDER_RESPONSE', stage: 'parse', httpStatus: response.status }) }
        const result = payload?.data?.[0] ?? payload?.effectImage
        const url = result?.url || (result?.b64_json ? `data:image/png;base64,${result.b64_json}` : null)
        if (!url) throw diagnosticError('Provider response did not contain an image', { code: 'INVALID_PROVIDER_RESPONSE', stage: 'validation', httpStatus: response.status })
        const providerMs = Date.now() - startedAt
        return { effectImage: { url, mimeType: result?.mimeType ?? 'image/png' }, generationPrompt: analysis.prompt, timings: { providerMs, conversationMs: analysis.providerMs } }
      } catch (reason) {
        const timeout = reason?.name === 'TimeoutError' || reason?.code === 'ABORT_ERR'
        const failure = timeout ? diagnosticError('Provider request timed out', { code: 'PROVIDER_TIMEOUT', stage: 'request' }) : reason
        logger.error?.('[Generation]', { traceId, stage: failure?.stage ?? 'request', provider: provider.name, model: provider.model, protocol, code: failure?.code ?? 'PROVIDER_REQUEST_FAILED', elapsedMs: Date.now() - startedAt, ...(failure?.httpStatus ? { httpStatus: failure.httpStatus } : {}) })
        throw failure
      }
    },
  }
}

const TEST_MAX_IMAGE_BYTES = 10 * 1024 * 1024
const PROVIDER_TEST_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

function validImageBytes(bytes) {
  if (!bytes?.length || bytes.length > TEST_MAX_IMAGE_BYTES) return false
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const png = bytes.length >= 8 && Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).equals(bytes.subarray(0, 8))
  return jpeg || png
}

async function validProviderTestImage(image, fetchImpl) {
  if (typeof image !== 'string' || !image) return false
  const dataUrl = image.match(/^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/u)
  if (dataUrl) return validImageBytes(Buffer.from(dataUrl[1], 'base64'))
  if (/^[A-Za-z0-9+/]+={0,2}$/u.test(image)) return validImageBytes(Buffer.from(image, 'base64'))
  let url
  try { url = new URL(image) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' })
  if (!response.ok) return false
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > TEST_MAX_IMAGE_BYTES) return false
  const bytes = Buffer.from(await response.arrayBuffer())
  return validImageBytes(bytes)
}

export async function testConfiguredConversationProvider({ endpoint, model, apiKey, traceId, fetchImpl = globalThis.fetch, timeoutMs = PROVIDER_TEST_TIMEOUT_MS }) {
  const startedAt = Date.now()
  const request = conversationRequest({ model, image: { type: 'image/png', data: PROVIDER_TEST_PNG }, params: { room: '客厅', theme: '现代简约', scale: '均衡', userPrompt: '保持结构不变，进行克制的真实室内改造。' }, apiKey, traceId })
  let response
  try {
    response = await fetchImpl(conversationEndpoint(endpoint), { method: 'POST', ...request, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
  } catch (reason) {
    const timeout = reason?.name === 'TimeoutError' || reason?.name === 'AbortError' || reason?.code === 'ABORT_ERR' || reason?.code === 23
    return { ok: false, code: timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_REQUEST_FAILED', message: timeout ? `Provider 在 ${Math.round(timeoutMs / 1000)} 秒内未返回结果` : '无法连接 Provider', stage: 'request', protocol: 'chat-completions', elapsedMs: Date.now() - startedAt }
  }
  if (!response.ok) {
    const diagnostic = await upstreamFailure(response)
    return { ok: false, code: 'PROVIDER_TEST_FAILED', message: diagnostic.upstreamMessage ?? `Provider returned ${response.status}`, stage: 'response', httpStatus: response.status, protocol: 'chat-completions', elapsedMs: Date.now() - startedAt, ...diagnostic }
  }
  let payload
  try { payload = await response.json() } catch { return { ok: false, code: 'INVALID_PROVIDER_RESPONSE', message: 'Provider 返回的不是有效 JSON', stage: 'parse', httpStatus: response.status, protocol: 'chat-completions', elapsedMs: Date.now() - startedAt } }
  try { extractSopPrompt(conversationContent(payload)) } catch { return { ok: false, code: 'INVALID_PROVIDER_RESPONSE', message: '对话 Provider 未返回规定格式的图生图提示词', stage: 'validation', httpStatus: response.status, protocol: 'chat-completions', elapsedMs: Date.now() - startedAt } }
  return { ok: true, httpStatus: response.status, protocol: 'chat-completions', elapsedMs: Date.now() - startedAt }
}

export async function testConfiguredProvider({ endpoint, model, apiKey, traceId, kind = 'image', fetchImpl = globalThis.fetch, timeoutMs = PROVIDER_TEST_TIMEOUT_MS }) {
  if (kind === 'conversation') return testConfiguredConversationProvider({ endpoint, model, apiKey, traceId, fetchImpl, timeoutMs })
  const startedAt = Date.now()
  const protocol = providerProtocol(endpoint, kind)
  const request = imageProviderRequest({
    endpoint,
    model,
    image: { type: 'image/png', data: PROVIDER_TEST_PNG },
    prompt: 'Edit this room reference image while preserving its geometry and camera viewpoint. Apply a minimal modern interior style.',
    apiKey,
    traceId,
  })
  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      ...request,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    })
  } catch (reason) {
    const timeout = reason?.name === 'TimeoutError' || reason?.name === 'AbortError' || reason?.code === 'ABORT_ERR' || reason?.code === 23
    return {
      ok: false,
      code: timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_REQUEST_FAILED',
      message: timeout ? `Provider 在 ${Math.round(timeoutMs / 1000)} 秒内未返回结果` : '无法连接 Provider',
      stage: 'request',
      protocol,
      elapsedMs: Date.now() - startedAt,
    }
  }
  if (!response.ok) {
    const diagnostic = await upstreamFailure(response)
    return { ok: false, code: 'PROVIDER_TEST_FAILED', message: diagnostic.upstreamMessage ?? `Provider returned ${response.status}`, stage: 'response', httpStatus: response.status, protocol, elapsedMs: Date.now() - startedAt, ...diagnostic }
  }
  let payload
  try { payload = await response.json() } catch { return { ok: false, code: 'INVALID_PROVIDER_RESPONSE', message: 'Provider 返回的不是有效 JSON', stage: 'parse', httpStatus: response.status, protocol, elapsedMs: Date.now() - startedAt } }
  const image = payload?.data?.[0]?.url || payload?.data?.[0]?.b64_json || payload?.effectImage?.url
  if (!await validProviderTestImage(image, fetchImpl)) return { ok: false, code: 'INVALID_PROVIDER_RESPONSE', message: 'Provider 未返回可验证的图片', stage: 'validation', httpStatus: response.status, protocol, elapsedMs: Date.now() - startedAt }
  return { ok: true, httpStatus: response.status, protocol, elapsedMs: Date.now() - startedAt }
}

export function createAppRuntime({ mailer, paymentProvider = localPaymentProvider(), generationProvider = localGenerationProvider(), providerTester = null, fetchImpl = globalThis.fetch, logger = console, encryptionKey = randomBytes(32), secureCookies = false, allowedOrigins = [], adminEmail = 'admin@example.com', stores = {}, objectStorage = null, close = () => {} } = {}) {
  const normalizedAdminEmail = String(adminEmail).trim().toLowerCase()
  const authService = new AuthService({ store: stores.auth ?? new MemoryAuthStore(), mailer, verificationSecret: encryptionKey, reservedRegistrationEmails: [normalizedAdminEmail] })
  const creditLedger = new CreditLedgerService({ authService, store: stores.credits ?? new MemoryCreditStore() })
  const isAdmin = (user) => user.email === normalizedAdminEmail
  const redemptionCodeService = new RedemptionCodeService({ authService, creditLedger, store: stores.redemptionCodes ?? new MemoryRedemptionCodeStore(), isAdmin, encryptionKey })
  const feedbackService = new FeedbackService({ authService, redemptionCodeService, mailer, store: stores.feedback ?? new MemoryFeedbackStore(), isAdmin, logger })
  const testProvider = providerTester ?? ((config) => testConfiguredProvider({ ...config, fetchImpl }))
  const adminProviderService = new AdminProviderService({ authService, store: stores.providers ?? new MemoryAdminProviderStore(), encryptionKey, isAdmin, testProvider, logger })
  const adminOverviewService = new AdminOverviewService({ database: stores.database, authService, isAdmin })
  const conversationProvider = configuredConversationProvider({ adminProviderService, fetchImpl, logger })
  const providers = new ProviderRegistry({ default: configuredGenerationProvider({ adminProviderService, fallback: generationProvider ?? localGenerationProvider(), conversationProvider, fetchImpl, logger }) })
  const adminStyleReferenceService = new AdminStyleReferenceService({ authService, store: stores.adminStyleReferences ?? new MemoryAdminStyleReferenceStore(), objectStorage, isAdmin })
  const generationStore = stores.generations ?? new MemoryGenerationStore()
  const builtInThemes = new Set(['现代简约', '北欧', '日式', '奶油风', '原木风', '轻奢', '中古风', '侘寂风', '自定义'])
  const themeValidator = (theme) => builtInThemes.has(theme) || [...adminStyleReferenceService.store.references.values()].some((reference) => reference.enabled && reference.theme === theme)
  const generationService = new GenerationService({ authService, store: generationStore, providers, creditLedger, objectStorage, fetchImpl, logger, themeValidator, isAdmin })
  const paymentService = new PaymentService({ authService, creditLedger, store: stores.payments ?? new MemoryPaymentStore(), provider: paymentProvider })
  const worksService = new WorksService({ authService, store: stores.works ?? new MemoryWorksStore() })
  const styleService = new StyleService({ authService, store: stores.styles ?? new MemoryStyleStore() })
  const api = new AppApi({ authService, generationService, creditLedger, paymentService, worksService, adminProviderService, redemptionCodeService, feedbackService, adminOverviewService, styleService, adminStyleReferenceService, objectStorage, secureCookies, allowedOrigins })
  const provisionAdmin = ({ password }) => authService.provisionUser({ email: normalizedAdminEmail, password })
  return { api, authService, creditLedger, generationService, paymentService, worksService, styleService, adminStyleReferenceService, adminProviderService, adminOverviewService, redemptionCodeService, feedbackService, objectStorage, provisionAdmin, close }
}
