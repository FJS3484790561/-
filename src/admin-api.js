const JSON_HEADERS = { 'content-type': 'application/json' }

export class ApiError extends Error {
  constructor(status, payload = {}) {
    super(payload.code || `HTTP_${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = payload.code || 'UNKNOWN_ERROR'
    this.serverMessage = payload.message
    this.upstreamMessage = payload.upstreamMessage
    this.fields = payload.fields || {}
    this.traceId = payload.traceId
    this.stage = payload.stage
    this.httpStatus = payload.httpStatus ?? status
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: options.body ? { ...JSON_HEADERS, ...options.headers } : options.headers,
  })
  let payload
  try {
    payload = await response.json()
  } catch {
    payload = { ok: false, code: 'INVALID_RESPONSE', message: '网关返回了非 JSON 响应（HTTP ' + response.status + '），尚未取得 Provider 测试结果。' }
  }
  if (!response.ok) throw new ApiError(response.status, payload)
  return payload
}

export const adminApi = {
  getOverview: () => request('/api/admin/overview'),
  session: () => request('/api/auth/session'),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST', body: '{}' }),
  listProviders: () => request('/api/admin/providers'),
  listStyleReferences: () => request('/api/admin/style-references'),
  createStyleReference: (values) => request('/api/admin/style-references', { method: 'POST', body: JSON.stringify(values) }),
  setStyleReferenceEnabled: (referenceId, enabled) => request(`/api/admin/style-references/${encodeURIComponent(referenceId)}/enabled`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  removeStyleReference: (referenceId) => request(`/api/admin/style-references/${encodeURIComponent(referenceId)}`, { method: 'DELETE' }),
  updateStyleReference: (referenceId, values) => request(`/api/admin/style-references/${encodeURIComponent(referenceId)}`, { method: 'PATCH', body: JSON.stringify(values) }),
  reorderStyleReferences: (referenceIds) => request('/api/admin/style-references/reorder', { method: 'POST', body: JSON.stringify({ referenceIds }) }),
  listGenerationDebug: () => request('/api/admin/generation-debug'),
  createProvider: (values) => request('/api/admin/providers', { method: 'POST', body: JSON.stringify(values) }),
  updateProvider: (providerId, values) => request(`/api/admin/providers/${encodeURIComponent(providerId)}`, { method: 'PATCH', body: JSON.stringify(values) }),
  testAndSaveProvider: async (values) => {
    const started = await request('/api/admin/providers/test', { method: 'POST', body: JSON.stringify({ ...values, asyncTest: true }) })
    if (!started.testId) return started
    const deadline = Date.now() + 5 * 60_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const state = await request('/api/admin/provider-tests/' + encodeURIComponent(started.testId))
      if (state.status === 'completed') {
        if (!state.result?.ok) throw new ApiError(state.result?.httpStatus || 502, state.result)
        return state.result
      }
    }
    throw new ApiError(504, { code: 'PROVIDER_TIMEOUT', message: '测试仍未完成，请先刷新 Provider 列表确认是否已保存，再决定重试。' })
  },
  setProviderEnabled: (providerId, enabled) => request(`/api/admin/providers/${encodeURIComponent(providerId)}/enabled`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  listAudit: (providerId) => request(`/api/admin/providers/${encodeURIComponent(providerId)}/audit`),
  listRedemptionCodes: () => request('/api/admin/redemption-codes'),
  createRedemptionCode: (values) => request('/api/admin/redemption-codes', { method: 'POST', body: JSON.stringify(values) }),
  removeRedemptionCode: (codeId) => request(`/api/admin/redemption-codes/${encodeURIComponent(codeId)}`, { method: 'DELETE' }),
  listFeedback: () => request('/api/admin/feedback'),
  decideFeedback: (feedbackId, decision, credits) => request(`/api/admin/feedback/${encodeURIComponent(feedbackId)}`, { method: 'POST', body: JSON.stringify({ decision, credits }) }),
  removeFeedback: (feedbackId) => request(`/api/admin/feedback/${encodeURIComponent(feedbackId)}`, { method: 'DELETE' }),
}
