import { randomBytes } from 'node:crypto'
import { AdminProviderService, MemoryAdminProviderStore } from './admin-provider-service.js'
import { AppApi } from './app-api.js'
import { AuthService, MemoryAuthStore } from './auth-service.js'
import { CreditLedgerService, MemoryCreditStore } from './credit-ledger.js'
import { GenerationService, MemoryGenerationStore, ProviderRegistry } from './generation-service.js'
import { MemoryPaymentStore, PaymentService } from './payment-service.js'
import { MemoryWorksStore, WorksService } from './works-service.js'

function localPaymentProvider() {
  return {
    createPayment: ({ orderId }) => ({ providerPaymentId: `local_${orderId}`, checkoutUrl: null }),
    verifyCallback: () => false,
  }
}

function localGenerationProvider() {
  return { generate: async ({ image }) => ({ effectImage: { url: `data:${image.type};base64,${Buffer.from(image.data).toString('base64')}`, mimeType: image.type } }) }
}

const GENERATION_TIMEOUT_MS = 30_000

function generationPrompt(params = {}) {
  const preferences = []
  if (params.preferences?.layout) preferences.push('preserve a practical room layout')
  if (params.preferences?.storage) preferences.push('include thoughtful storage')
  if (params.preferences?.light) preferences.push('improve natural and ambient lighting')
  return [
    `Create a photorealistic interior design rendering for a ${params.room ?? 'room'}.`,
    `Style: ${params.theme ?? 'modern'}.`,
    `Renovation intensity: ${params.scale ?? 'balanced'}.`,
    preferences.length ? `Requirements: ${preferences.join(', ')}.` : '',
    'Show a coherent, buildable residential interior with realistic materials and lighting.',
  ].filter(Boolean).join(' ')
}

function diagnosticError(message, { code, stage, httpStatus } = {}) {
  const error = new Error(message)
  error.code = code
  error.stage = stage
  if (httpStatus) error.httpStatus = httpStatus
  return error
}

export function configuredGenerationProvider({ adminProviderService, fallback, fetchImpl = globalThis.fetch, logger = console, timeoutMs = GENERATION_TIMEOUT_MS }) {
  return {
    generate: async ({ image, params, traceId }) => {
      const configured = adminProviderService.getEnabledConfig()
      if (!configured.ok) return fallback.generate({ image, params, traceId })
      const provider = configured.provider
      logger.info?.('[Generation]', { traceId, stage: 'provider-request', provider: provider.name, model: provider.model })
      try {
        const response = await fetchImpl(provider.endpoint, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}`, 'x-request-id': traceId },
          body: JSON.stringify({ model: provider.model, prompt: generationPrompt(params), size: '1024x1024', n: 1, response_format: 'url' }),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        })
        logger.info?.('[Generation]', { traceId, stage: 'provider-response', provider: provider.name, model: provider.model, httpStatus: response.status })
        if (!response.ok) throw diagnosticError('Provider request failed', { code: 'PROVIDER_HTTP_ERROR', stage: 'response', httpStatus: response.status })
        let payload
        try { payload = await response.json() } catch { throw diagnosticError('Provider response was not JSON', { code: 'INVALID_PROVIDER_RESPONSE', stage: 'parse', httpStatus: response.status }) }
        const result = payload?.data?.[0] ?? payload?.effectImage
        const url = result?.url || (result?.b64_json ? `data:image/png;base64,${result.b64_json}` : null)
        if (!url) throw diagnosticError('Provider response did not contain an image', { code: 'INVALID_PROVIDER_RESPONSE', stage: 'validation', httpStatus: response.status })
        return { effectImage: { url, mimeType: result?.mimeType ?? 'image/png' } }
      } catch (reason) {
        const timeout = reason?.name === 'TimeoutError' || reason?.code === 'ABORT_ERR'
        const failure = timeout ? diagnosticError('Provider request timed out', { code: 'PROVIDER_TIMEOUT', stage: 'request' }) : reason
        logger.error?.('[Generation]', { traceId, stage: failure?.stage ?? 'request', provider: provider.name, model: provider.model, code: failure?.code ?? 'PROVIDER_REQUEST_FAILED', ...(failure?.httpStatus ? { httpStatus: failure.httpStatus } : {}) })
        throw failure
      }
    },
  }
}

const TEST_MAX_IMAGE_BYTES = 10 * 1024 * 1024

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

async function testConfiguredProvider({ endpoint, model, apiKey, traceId, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(endpoint, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'x-request-id': traceId }, body: JSON.stringify({ model, prompt: 'A minimal interior design test image.', size: '1024x1024', n: 1, response_format: 'url' }), signal: AbortSignal.timeout(30_000), redirect: 'error' })
  if (!response.ok) return { ok: false, code: 'PROVIDER_TEST_FAILED', message: `Provider returned ${response.status}`, stage: 'response', httpStatus: response.status }
  let payload
  try { payload = await response.json() } catch { return { ok: false, code: 'INVALID_PROVIDER_RESPONSE', message: 'Provider 返回的不是有效 JSON', stage: 'parse', httpStatus: response.status } }
  const image = payload?.data?.[0]?.url || payload?.data?.[0]?.b64_json || payload?.effectImage?.url
  if (!await validProviderTestImage(image, fetchImpl)) return { ok: false, code: 'INVALID_PROVIDER_RESPONSE', message: 'Provider 未返回可验证的图片', stage: 'validation', httpStatus: response.status }
  return { ok: true, httpStatus: response.status }
}

export function createAppRuntime({ mailer, paymentProvider = localPaymentProvider(), generationProvider = localGenerationProvider(), providerTester = null, fetchImpl = globalThis.fetch, logger = console, encryptionKey = randomBytes(32), secureCookies = false, allowedOrigins = [], adminEmail = 'admin@example.com', stores = {}, objectStorage = null, close = () => {} } = {}) {
  const normalizedAdminEmail = String(adminEmail).trim().toLowerCase()
  const authService = new AuthService({ store: stores.auth ?? new MemoryAuthStore(), mailer, reservedRegistrationEmails: [normalizedAdminEmail] })
  const creditLedger = new CreditLedgerService({ authService, store: stores.credits ?? new MemoryCreditStore() })
  const testProvider = providerTester ?? ((config) => testConfiguredProvider({ ...config, fetchImpl }))
  const adminProviderService = new AdminProviderService({ authService, store: stores.providers ?? new MemoryAdminProviderStore(), encryptionKey, isAdmin: (user) => user.email === normalizedAdminEmail, testProvider, logger })
  const providers = new ProviderRegistry({ default: configuredGenerationProvider({ adminProviderService, fallback: generationProvider ?? localGenerationProvider(), fetchImpl, logger }) })
  const generationService = new GenerationService({ authService, store: stores.generations ?? new MemoryGenerationStore(), providers, creditLedger, objectStorage, fetchImpl, logger })
  const paymentService = new PaymentService({ authService, creditLedger, store: stores.payments ?? new MemoryPaymentStore(), provider: paymentProvider })
  const worksService = new WorksService({ authService, store: stores.works ?? new MemoryWorksStore() })
  const api = new AppApi({ authService, generationService, creditLedger, paymentService, worksService, adminProviderService, objectStorage, secureCookies, allowedOrigins })
  const provisionAdmin = ({ password }) => authService.provisionUser({ email: normalizedAdminEmail, password })
  return { api, authService, creditLedger, generationService, paymentService, worksService, adminProviderService, objectStorage, provisionAdmin, close }
}
