export class ApiError extends Error {
  constructor(code, status = 0) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: options.body ? { 'content-type': 'application/json', ...options.headers } : options.headers,
  })
  let data
  try {
    data = await response.json()
  } catch {
    throw new ApiError('INVALID_RESPONSE', response.status)
  }
  if (!response.ok || !data.ok) throw new ApiError(data.code ?? 'REQUEST_FAILED', response.status)
  return data
}

const post = (path, body) => request(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

export const api = {
  session: () => request('/api/auth/session'),
  register: (email, password) => post('/api/auth/register', { email, password }),
  login: (email, password) => post('/api/auth/login', { email, password }),
  logout: () => post('/api/auth/logout'),
  requestPasswordReset: (email) => post('/api/auth/password-reset/request', { email }),
  resetPassword: (token, password) => post('/api/auth/password-reset/confirm', { token, password }),
  credits: () => request('/api/credits'),
  createGeneration: (payload) => post('/api/generations', payload),
  generation: (id) => request(`/api/generations/${encodeURIComponent(id)}`),
  works: () => request('/api/works'),
  work: (id) => request(`/api/works/${encodeURIComponent(id)}`),
  saveWork: (payload) => post('/api/works', payload),
  createOrder: (amountYuan) => post('/api/orders', { amountYuan }),
  order: (id) => request(`/api/orders/${encodeURIComponent(id)}`),
}

export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new ApiError('FILE_READ_FAILED'))
    reader.onload = () => {
      const dataUrl = String(reader.result)
      resolve({
        previewUrl: dataUrl,
        payload: { name: file.name, type: file.type, dataBase64: dataUrl.split(',', 2)[1] ?? '' },
      })
    }
    reader.readAsDataURL(file)
  })
}

export async function pollGeneration(id, { interval = 350, signal, onUpdate } = {}) {
  const startedAt = Date.now()
  let attempt = 0
  let lastStatus = null
  console.info('[Generation]', { stage: 'polling-started', traceId: id })
  while (!signal?.aborted) {
    attempt += 1
    let task
    try {
      ({ task } = await api.generation(id))
    } catch (error) {
      console.error('[Generation]', { stage: 'polling-request-failed', traceId: id, attempt, elapsedMs: Date.now() - startedAt, code: error?.code ?? 'REQUEST_FAILED', httpStatus: error?.status ?? 0 })
      throw error
    }
    onUpdate?.(task)
    if (task.status !== lastStatus || attempt % 10 === 0) {
      console.info('[Generation]', { stage: 'polling', traceId: task.traceId ?? id, taskId: id, status: task.status, attempt, elapsedMs: Date.now() - startedAt })
      lastStatus = task.status
    }
    if (task.status === 'succeeded' || task.status === 'failed') {
      const details = { stage: task.status, traceId: task.traceId ?? id, taskId: id, attempt, elapsedMs: Date.now() - startedAt }
      if (task.status === 'failed') console.error('[Generation]', { ...details, code: task.error?.code ?? 'GENERATION_FAILED' })
      else console.info('[Generation]', details)
      return task
    }
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(resolve, interval)
      signal?.addEventListener('abort', () => {
        window.clearTimeout(timeout)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })
  }
  console.info('[Generation]', { stage: 'polling-aborted', traceId: id, attempt, elapsedMs: Date.now() - startedAt })
  throw new DOMException('Aborted', 'AbortError')
}
