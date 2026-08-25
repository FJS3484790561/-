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
  while (!signal?.aborted) {
    const { task } = await api.generation(id)
    onUpdate?.(task)
    if (task.status === 'succeeded' || task.status === 'failed') return task
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(resolve, interval)
      signal?.addEventListener('abort', () => {
        window.clearTimeout(timeout)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })
  }
  throw new DOMException('Aborted', 'AbortError')
}
