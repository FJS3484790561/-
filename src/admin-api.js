const JSON_HEADERS = { 'content-type': 'application/json' }

export class ApiError extends Error {
  constructor(status, payload = {}) {
    super(payload.code || `HTTP_${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = payload.code || 'UNKNOWN_ERROR'
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
    payload = { ok: false, code: 'INVALID_RESPONSE' }
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
  createProvider: (values) => request('/api/admin/providers', { method: 'POST', body: JSON.stringify(values) }),
  updateProvider: (providerId, values) => request(`/api/admin/providers/${encodeURIComponent(providerId)}`, { method: 'PATCH', body: JSON.stringify(values) }),
  testAndSaveProvider: (values) => request('/api/admin/providers/test', { method: 'POST', body: JSON.stringify(values) }),
  setProviderEnabled: (providerId, enabled) => request(`/api/admin/providers/${encodeURIComponent(providerId)}/enabled`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  listAudit: (providerId) => request(`/api/admin/providers/${encodeURIComponent(providerId)}/audit`),
  listRedemptionCodes: () => request('/api/admin/redemption-codes'),
  createRedemptionCode: (values) => request('/api/admin/redemption-codes', { method: 'POST', body: JSON.stringify(values) }),
  removeRedemptionCode: (codeId) => request(`/api/admin/redemption-codes/${encodeURIComponent(codeId)}`, { method: 'DELETE' }),
  listFeedback: () => request('/api/admin/feedback'),
  decideFeedback: (feedbackId, decision, credits) => request(`/api/admin/feedback/${encodeURIComponent(feedbackId)}`, { method: 'POST', body: JSON.stringify({ decision, credits }) }),
  removeFeedback: (feedbackId) => request(`/api/admin/feedback/${encodeURIComponent(feedbackId)}`, { method: 'DELETE' }),
}
