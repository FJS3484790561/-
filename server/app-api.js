const DEFAULT_MAX_JSON_BYTES = 16 * 1024 * 1024
const SESSION_COOKIE = 'session'
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30

  const statusByCode = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RESERVATION_NOT_FOUND: 404,
  PROVIDER_NOT_AVAILABLE: 404,
  EMAIL_ALREADY_REGISTERED: 409,
  PROVIDER_ALREADY_EXISTS: 409,
  INSUFFICIENT_CREDITS: 409,
  PAYMENT_PROVIDER_UNAVAILABLE: 503,
  PROVIDER_UNAVAILABLE: 503,
  GENERATION_TIMEOUT: 504,
  PROVIDER_TEST_FAILED: 502,
  INVALID_PROVIDER_RESPONSE: 502,
  PROVIDER_TEST_UNAVAILABLE: 503,
  OVERVIEW_UNAVAILABLE: 503,
  REDEMPTION_CODE_ALREADY_USED: 409,
  REDEMPTION_CODE_EXHAUSTED: 409,
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })
}

function safeResult(result, successStatus = 200, headers = {}) {
  if (result?.ok) return json(result, successStatus, headers)
  return json(result ?? { ok: false, code: 'INTERNAL_ERROR' }, statusByCode[result?.code] ?? 400, headers)
}

function cookieValue(request, name) {
  const cookie = request.headers.get('cookie') ?? ''
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return undefined
}

function sessionCookie(token, { secureCookies, clear = false }) {
  const parts = [`${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (clear) parts.push('Max-Age=0')
  else parts.push(`Max-Age=${7 * 24 * 60 * 60}`)
  if (secureCookies) parts.push('Secure')
  return parts.join('; ')
}

async function readJson(request, maxBytes) {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'application/json') return { error: json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' }, 415) }
  const reader = request.body?.getReader()
  if (!reader) return { value: {} }
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return { error: json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413) }
    }
    chunks.push(value)
  }
  try {
    const payload = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
    return { value: payload ? JSON.parse(payload) : {} }
  } catch {
    return { error: json({ ok: false, code: 'INVALID_JSON' }, 400) }
  }
}

function decodeImage(image) {
  if (!image || typeof image.dataBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/u.test(image.dataBase64)) return image
  const dimensions = Number.isInteger(image.width) && image.width > 0 && Number.isInteger(image.height) && image.height > 0
    ? { width: image.width, height: image.height }
    : {}
  return { name: image.name, type: image.type, ...dimensions, data: Buffer.from(image.dataBase64, 'base64') }
}

export class AppApi {
  constructor({ authService, generationService, creditLedger, paymentService, worksService, adminProviderService, redemptionCodeService, adminOverviewService = null, styleService, objectStorage = null, maxJsonBytes = DEFAULT_MAX_JSON_BYTES, secureCookies = false, allowedOrigins = [] } = {}) {
    if (!authService || !generationService || !creditLedger || !paymentService || !worksService || !adminProviderService || !redemptionCodeService) throw new Error('all application services are required')
    this.authService = authService
    this.generationService = generationService
    this.creditLedger = creditLedger
    this.paymentService = paymentService
    this.worksService = worksService
    this.adminProviderService = adminProviderService
    this.redemptionCodeService = redemptionCodeService
    this.adminOverviewService = adminOverviewService
    this.styleService = styleService
    this.objectStorage = objectStorage
    this.maxJsonBytes = maxJsonBytes
    this.secureCookies = secureCookies
    this.allowedOrigins = new Set(allowedOrigins)
    this.rateLimits = new Map()
  }

  async handle(request, context = {}) {
    try {
      const response = await this.#route(request, context)
      const headers = new Headers(response.headers)
      headers.set('x-content-type-options', 'nosniff')
      headers.set('x-frame-options', 'DENY')
      headers.set('referrer-policy', 'no-referrer')
      headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()')
      return new Response(response.body, { status: response.status, headers })
    } catch {
      return json({ ok: false, code: 'INTERNAL_ERROR' }, 500)
    }
  }

  async #route(request, { clientAddress = 'local' } = {}) {
    const { pathname } = new URL(request.url)
    const method = request.method.toUpperCase()
    if (method === 'GET' && pathname === '/api/health') return json({ ok: true, status: 'ready' })

    if (WRITE_METHODS.has(method) && pathname.startsWith('/api/')) {
      const origin = request.headers.get('origin')
      if (pathname !== '/api/payment-callback' && (!origin || (origin !== new URL(request.url).origin && !this.allowedOrigins.has(origin)))) return json({ ok: false, code: 'CSRF_ORIGIN_MISMATCH' }, 403)
      const key = `${clientAddress}:${pathname}`
      const now = Date.now()
      const previous = this.rateLimits.get(key)
      const entry = previous && now - previous.startedAt < RATE_LIMIT_WINDOW_MS ? previous : { startedAt: now, count: 0 }
      entry.count += 1
      this.rateLimits.set(key, entry)
      if (entry.count > RATE_LIMIT_MAX) return json({ ok: false, code: 'RATE_LIMITED' }, 429, { 'retry-after': '60' })
    }

    const sessionToken = cookieValue(request, SESSION_COOKIE)
    const withJsonBody = async (handler) => {
      const bodyResult = await readJson(request, this.maxJsonBytes)
      return bodyResult.error ?? handler(bodyResult.value)
    }

    if (method === 'POST' && pathname === '/api/auth/register') return withJsonBody(async (body) => safeResult(await this.authService.register(body), 201))
    if (method === 'POST' && pathname === '/api/auth/login') {
      return withJsonBody(async (body) => {
        const result = await this.authService.login(body)
        if (!result.ok) return safeResult(result)
        return json({ ok: true, user: result.user, expiresAt: result.expiresAt }, 200, { 'set-cookie': sessionCookie(result.sessionToken, this) })
      })
    }
    if (method === 'GET' && pathname === '/api/auth/session') {
      const user = this.authService.getSession(sessionToken)
      return user ? json({ ok: true, user }) : json({ ok: false, code: 'UNAUTHORIZED' }, 401)
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      if (sessionToken) this.authService.logout(sessionToken)
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', { secureCookies: this.secureCookies, clear: true }) })
    }
    if (method === 'POST' && pathname === '/api/auth/password-reset/request') return withJsonBody(async (body) => safeResult(await this.authService.requestPasswordReset(body.email)))
    if (method === 'POST' && pathname === '/api/auth/password-reset/confirm') return withJsonBody(async (body) => safeResult(await this.authService.resetPassword(body)))

    if (method === 'POST' && pathname === '/api/generations') return withJsonBody(async (body) => safeResult(await this.generationService.createGeneration({ sessionToken, image: decodeImage(body.image), params: { ...(body.params ?? {}), styleReference: decodeImage(body.params?.styleReference) } }), 202))
    const generationMatch = pathname.match(/^\/api\/generations\/([^/]+)$/u)
    if (method === 'GET' && generationMatch) return safeResult(this.generationService.getGeneration({ sessionToken, taskId: decodeURIComponent(generationMatch[1]) }))
    const objectMatch = pathname.match(/^\/api\/objects\/([^/]+)$/u)
    if (method === 'GET' && objectMatch && this.objectStorage) {
      const user = this.authService.getSession(sessionToken)
      if (!user) return json({ ok: false, code: 'UNAUTHORIZED' }, 401)
      const key = decodeURIComponent(objectMatch[1])
      const metadata = this.objectStorage.metadataFor(key)
      if (!metadata || metadata.ownerId !== user.id) return json({ ok: false, code: 'NOT_FOUND' }, 404)
      const object = await this.objectStorage.get({ key })
      return new Response(object.body, { status: 200, headers: { 'content-type': metadata.mimeType, 'content-length': String(metadata.sizeBytes), 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } })
    }

    if (method === 'GET' && pathname === '/api/credits') return safeResult(this.creditLedger.getBalance({ sessionToken }))
    if (method === 'POST' && pathname === '/api/redemption-codes/redeem') return withJsonBody((body) => safeResult(this.redemptionCodeService.redeem({ sessionToken, code: body.code })))
    if (method === 'POST' && pathname === '/api/orders') return withJsonBody((body) => safeResult(this.paymentService.createOrder({ sessionToken, amountYuan: body.amountYuan }), 201))
    const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/u)
    if (method === 'GET' && orderMatch) return safeResult(this.paymentService.getOrder({ sessionToken, orderId: decodeURIComponent(orderMatch[1]) }))
    if (method === 'POST' && pathname === '/api/payment-callback') return withJsonBody((body) => safeResult(this.paymentService.handleCallback(body)))

    if (method === 'POST' && pathname === '/api/works') return withJsonBody((body) => safeResult(this.worksService.create({ ...body, sessionToken }), 201))
    if (method === 'GET' && pathname === '/api/works') return safeResult(this.worksService.list({ sessionToken }))
    if (method === 'GET' && pathname === '/api/styles') return safeResult(this.styleService.list({ sessionToken }))
    if (method === 'POST' && pathname === '/api/styles') return withJsonBody(async (body) => safeResult(await this.styleService.create({ sessionToken, name: body.name, prompt: body.prompt, image: decodeImage(body.image) }), 201))
    const workMatch = pathname.match(/^\/api\/works\/([^/]+)$/u)
    if (method === 'GET' && workMatch) return safeResult(this.worksService.get({ sessionToken, workId: decodeURIComponent(workMatch[1]) }))

    if (method === 'GET' && pathname === '/api/admin/providers') return safeResult(this.adminProviderService.list({ sessionToken }))
    if (method === 'GET' && pathname === '/api/admin/overview' && this.adminOverviewService) return safeResult(this.adminOverviewService.get({ sessionToken }))
    if (method === 'GET' && pathname === '/api/admin/redemption-codes') return safeResult(this.redemptionCodeService.list({ sessionToken }))
    if (method === 'POST' && pathname === '/api/admin/redemption-codes') return withJsonBody((body) => safeResult(this.redemptionCodeService.create({ sessionToken, credits: body.credits, maxRedemptions: body.maxRedemptions }), 201))
    if (method === 'POST' && pathname === '/api/admin/providers') return withJsonBody(async (body) => safeResult(await this.adminProviderService.create({ ...body, sessionToken }), 201))
    const auditMatch = pathname.match(/^\/api\/admin\/providers\/([^/]+)\/audit$/u)
    if (method === 'GET' && auditMatch) return safeResult(this.adminProviderService.listAudit({ sessionToken, providerId: decodeURIComponent(auditMatch[1]) }))
    const enabledMatch = pathname.match(/^\/api\/admin\/providers\/([^/]+)\/enabled$/u)
    if (method === 'POST' && enabledMatch) return withJsonBody((body) => safeResult(this.adminProviderService.setEnabled({ sessionToken, providerId: decodeURIComponent(enabledMatch[1]), enabled: body.enabled })))
    const providerMatch = pathname.match(/^\/api\/admin\/providers\/([^/]+)$/u)
    if (method === 'GET' && providerMatch) return safeResult(this.adminProviderService.get({ sessionToken, providerId: decodeURIComponent(providerMatch[1]) }))
    if (method === 'PATCH' && providerMatch) return withJsonBody(async (body) => safeResult(await this.adminProviderService.update({ ...body, sessionToken, providerId: decodeURIComponent(providerMatch[1]) })))
    if (method === 'POST' && pathname === '/api/admin/providers/test') return withJsonBody(async (body) => safeResult(await this.adminProviderService.testAndSave({ ...body, sessionToken }), body.providerId ? 200 : 201))

    return json({ ok: false, code: 'NOT_FOUND' }, 404)
  }
}

export const appApiConstants = { DEFAULT_MAX_JSON_BYTES, SESSION_COOKIE }
