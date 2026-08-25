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

export function createAppRuntime({ mailer, paymentProvider = localPaymentProvider(), generationProvider = localGenerationProvider(), encryptionKey = randomBytes(32), secureCookies = false, adminEmail = 'admin@example.com', stores = {}, objectStorage = null, close = () => {} } = {}) {
  const normalizedAdminEmail = String(adminEmail).trim().toLowerCase()
  const authService = new AuthService({ store: stores.auth ?? new MemoryAuthStore(), mailer, reservedRegistrationEmails: [normalizedAdminEmail] })
  const creditLedger = new CreditLedgerService({ authService, store: stores.credits ?? new MemoryCreditStore() })
  const providers = new ProviderRegistry({ default: generationProvider })
  const generationService = new GenerationService({ authService, store: stores.generations ?? new MemoryGenerationStore(), providers, creditLedger, objectStorage })
  const paymentService = new PaymentService({ authService, creditLedger, store: stores.payments ?? new MemoryPaymentStore(), provider: paymentProvider })
  const worksService = new WorksService({ authService, store: stores.works ?? new MemoryWorksStore() })
  const adminProviderService = new AdminProviderService({ authService, store: stores.providers ?? new MemoryAdminProviderStore(), encryptionKey, isAdmin: (user) => user.email === normalizedAdminEmail })
  const api = new AppApi({ authService, generationService, creditLedger, paymentService, worksService, adminProviderService, objectStorage, secureCookies })
  const provisionAdmin = ({ password }) => authService.provisionUser({ email: normalizedAdminEmail, password })
  return { api, authService, creditLedger, generationService, paymentService, worksService, adminProviderService, objectStorage, provisionAdmin, close }
}
