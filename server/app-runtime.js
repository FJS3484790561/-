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

function configuredGenerationProvider({ adminProviderService, fallback, fetchImpl = globalThis.fetch }) {
  return {
    generate: async ({ image, params }) => {
      const configured = adminProviderService.getEnabledConfig()
      if (!configured.ok) return fallback.generate({ image, params })
      const provider = configured.provider
      const response = await fetchImpl(provider.endpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({ model: provider.model, image: `data:${image.type};base64,${Buffer.from(image.data).toString('base64')}`, params }),
        redirect: 'error',
      })
      if (!response.ok) throw new Error(`Provider returned ${response.status}`)
      const payload = await response.json()
      return { effectImage: payload.effectImage ?? payload.data?.effectImage ?? payload.data?.[0] }
    },
  }
}

async function testConfiguredProvider({ endpoint, model, apiKey, traceId, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(endpoint, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'x-request-id': traceId }, body: JSON.stringify({ model, prompt: 'A minimal interior design test image.', size: '1024x1024', n: 1, response_format: 'url' }), redirect: 'error' })
  if (!response.ok) return { ok: false, code: 'PROVIDER_TEST_FAILED', message: `Provider returned ${response.status}`, stage: 'response' }
  const payload = await response.json()
  const image = payload?.data?.[0]?.url || payload?.data?.[0]?.b64_json || payload?.effectImage?.url
  if (!image) return { ok: false, code: 'INVALID_PROVIDER_RESPONSE', message: 'Provider 未返回图片结果', stage: 'validation' }
  return { ok: true }
}

export function createAppRuntime({ mailer, paymentProvider = localPaymentProvider(), generationProvider = localGenerationProvider(), encryptionKey = randomBytes(32), secureCookies = false, allowedOrigins = [], adminEmail = 'admin@example.com', stores = {}, objectStorage = null, close = () => {} } = {}) {
  const normalizedAdminEmail = String(adminEmail).trim().toLowerCase()
  const authService = new AuthService({ store: stores.auth ?? new MemoryAuthStore(), mailer, reservedRegistrationEmails: [normalizedAdminEmail] })
  const creditLedger = new CreditLedgerService({ authService, store: stores.credits ?? new MemoryCreditStore() })
  const adminProviderService = new AdminProviderService({ authService, store: stores.providers ?? new MemoryAdminProviderStore(), encryptionKey, isAdmin: (user) => user.email === normalizedAdminEmail, testProvider: (config) => testConfiguredProvider(config) })
  const providers = new ProviderRegistry({ default: configuredGenerationProvider({ adminProviderService, fallback: generationProvider ?? localGenerationProvider() }) })
  const generationService = new GenerationService({ authService, store: stores.generations ?? new MemoryGenerationStore(), providers, creditLedger, objectStorage })
  const paymentService = new PaymentService({ authService, creditLedger, store: stores.payments ?? new MemoryPaymentStore(), provider: paymentProvider })
  const worksService = new WorksService({ authService, store: stores.works ?? new MemoryWorksStore() })
  const api = new AppApi({ authService, generationService, creditLedger, paymentService, worksService, adminProviderService, objectStorage, secureCookies, allowedOrigins })
  const provisionAdmin = ({ password }) => authService.provisionUser({ email: normalizedAdminEmail, password })
  return { api, authService, creditLedger, generationService, paymentService, worksService, adminProviderService, objectStorage, provisionAdmin, close }
}
