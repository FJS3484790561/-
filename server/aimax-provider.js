import { setTimeout as delay } from 'node:timers/promises'

export function isAimax(endpoint, model) {
  return model === 'gpt-image-2.5' && aimaxEndpoint(endpoint) !== null
}

export function aimaxEndpoint(endpoint) {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.hostname !== 'api.aimaxa.cn' || url.port || url.username || url.password || url.search || url.hash) return null
    if (!['', '/v1', '/v1/images/generations'].includes(url.pathname.replace(/\/$/u, ''))) return null
    url.pathname = '/v1/images/generations'
    return url.toString()
  } catch { return null }
}

function failure(code, stage, message, httpStatus) {
  return Object.assign(new Error(message), { code, stage, ...(httpStatus ? { httpStatus } : {}) })
}

export async function runAimax({ endpoint, model, apiKey, traceId, imageUrl, prompt, fetchImpl = globalThis.fetch, timeoutMs = 150_000, pollMs = 2000 }) {
  const submitEndpoint = aimaxEndpoint(endpoint)
  if (!submitEndpoint) throw failure('INVALID_PROVIDER_ENDPOINT', 'configuration', 'AImAX 接口地址无效，请填写 https://api.aimaxa.cn/v1/images/generations。')
  let reference
  try { reference = new URL(imageUrl) } catch { /* validated below */ }
  if (!reference || reference.protocol !== 'https:' || reference.username || reference.password) {
    throw failure('REFERENCE_IMAGE_UNAVAILABLE', 'reference', '无法创建原图的限时 HTTPS 链接，请检查图片存储配置。')
  }
  const signal = AbortSignal.timeout(timeoutMs)
  const headers = { authorization: `Bearer ${apiKey}`, accept: 'application/json', 'x-request-id': traceId }
  async function request(url, options, stage) {
    const response = await fetchImpl(url, { ...options, signal, redirect: 'error' })
    if (!response.ok) throw failure('PROVIDER_HTTP_ERROR', stage, `AImAX ${stage === 'submit' ? '提交' : '查询'}失败（HTTP ${response.status}）。`, response.status)
    let payload
    try { payload = await response.json() } catch { throw failure('INVALID_PROVIDER_RESPONSE', stage, 'AImAX 返回了非 JSON 响应。', response.status) }
    if (payload?.code !== 200 || !payload.data) throw failure('INVALID_PROVIDER_RESPONSE', stage, 'AImAX 返回的任务结构不符合接口协议。', response.status)
    return payload.data
  }
  try {
    let task = await request(submitEndpoint, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ model, version: 'sunburst', prompt, size: 'auto', resolution: '1k', images: [reference.toString()] }) }, 'submit')
    if (typeof task.task_id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/u.test(task.task_id)) throw failure('INVALID_PROVIDER_RESPONSE', 'submit', 'AImAX 未返回有效的任务编号。')
    const taskId = task.task_id
    const taskUrl = new URL(`/v1/tasks/${encodeURIComponent(taskId)}`, submitEndpoint).toString()
    while (true) {
      if (task.task_id && task.task_id !== taskId) throw failure('INVALID_PROVIDER_RESPONSE', 'poll', 'AImAX 返回了不匹配的任务编号。')
      if (task.status === 'succeeded') {
        const urls = Array.isArray(task.works) ? task.works.map((work) => work?.asset_url).filter((value) => {
          try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
        }) : []
        if (!urls.length) throw failure('INVALID_PROVIDER_RESPONSE', 'poll', 'AImAX 任务成功但没有有效图片地址。')
        return { url: urls[0], taskId }
      }
      if (task.status === 'failed') {
        // Upstream text can echo signed URLs or credentials; expose only a safe category.
        throw failure('PROVIDER_TASK_FAILED', 'poll', 'AImAX 已将任务标记为失败，请在 AImAX 任务记录中查看失败原因。')
      }
      if (!['submitted', 'processing', 'queued', 'pending'].includes(task.status)) throw failure('INVALID_PROVIDER_RESPONSE', 'poll', 'AImAX 返回了未知任务状态。')
      await delay(pollMs, undefined, { signal })
      task = await request(taskUrl, { method: 'GET', headers }, 'poll')
    }
  } catch (error) {
    if (signal.aborted) throw failure('PROVIDER_TIMEOUT', 'poll', 'AImAX 任务等待超时；上游任务可能仍在处理，请先查看其任务记录再重试。')
    if (error.code && error.stage) throw error
    throw failure('PROVIDER_REQUEST_FAILED', 'request', '无法连接 AImAX，请检查服务端网络。')
  }
}
