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
  redeemCode: (code) => post('/api/redemption-codes/redeem', { code }),
  createGeneration: (payload) => post('/api/generations', payload),
  generation: (id) => request(`/api/generations/${encodeURIComponent(id)}`),
  works: () => request('/api/works'),
  work: (id) => request(`/api/works/${encodeURIComponent(id)}`),
  saveWork: (payload) => post('/api/works', payload),
  createOrder: (amountYuan) => post('/api/orders', { amountYuan }),
  order: (id) => request(`/api/orders/${encodeURIComponent(id)}`),
}

export const UPLOAD_IMAGE_MAX_EDGE = 1600
export const UPLOAD_IMAGE_QUALITY = 0.88

function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new ApiError('FILE_READ_FAILED'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new ApiError('FILE_READ_FAILED'))
    image.onload = () => resolve(image)
    image.src = dataUrl
  })
}

function canvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', UPLOAD_IMAGE_QUALITY))
}

export async function fileToImage(file) {
  const startedAt = Date.now()
  const originalUrl = await readDataUrl(file)
  let sourceWidth
  let sourceHeight
  try {
    const image = await loadImage(originalUrl)
    sourceWidth = image.naturalWidth
    sourceHeight = image.naturalHeight
    const ratio = Math.min(1, UPLOAD_IMAGE_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * ratio))
    const height = Math.max(1, Math.round(image.naturalHeight * ratio))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    const optimized = await canvasBlob(canvas)
    if (!optimized) throw new Error('Image encoding failed')
    const uploadUrl = await readDataUrl(optimized)
    console.info('[Upload]', { stage: 'image-optimized', originalBytes: file.size, uploadBytes: optimized.size, width, height, elapsedMs: Date.now() - startedAt })
    return {
      previewUrl: originalUrl,
      payload: { name: file.name.replace(/\.[^.]+$/u, '') + '.jpg', type: 'image/jpeg', width, height, dataBase64: uploadUrl.split(',', 2)[1] ?? '' },
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    console.info('[Upload]', { stage: 'optimization-fallback', originalBytes: file.size, elapsedMs: Date.now() - startedAt })
    return { previewUrl: originalUrl, payload: { name: file.name, type: file.type, ...(sourceWidth && sourceHeight ? { width: sourceWidth, height: sourceHeight } : {}), dataBase64: originalUrl.split(',', 2)[1] ?? '' } }
  }
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
      const details = { stage: task.status, traceId: task.traceId ?? id, taskId: id, attempt, elapsedMs: Date.now() - startedAt, ...(task.timings ? { serverTimings: task.timings } : {}) }
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
