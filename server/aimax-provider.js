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
  const secret = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!secret || !/^[\x21-\x7e]+$/u.test(secret)) throw failure('INVALID_API_KEY_FORMAT', 'configuration', 'API 密钥格式无效，请只粘贴令牌本身，不要包含中文、换行、空格或 Bearer 前缀。')
  let reference
  try { reference = new URL(imageUrl) } catch { /* validated below */ }
  if (!reference || reference.protocol !== 'https:' || reference.username || reference.password) {
    throw failure('REFERENCE_IMAGE_UNAVAILABLE', 'reference', '无法创建原图的限时 HTTPS 链接，请检查图片存储配置。')
  }
  const signal = AbortSignal.timeout(timeoutMs)
  const headers = { authorization: `Bearer ${secret}`, accept: 'application/json', 'x-request-id': traceId }
  let requestStage = 'submit'
  async function request(url, options, stage) {
    requestStage = stage
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
    const cause = error.cause ?? error
    const networkErrors = {
      ENOTFOUND: 'DNS 解析失败', EAI_AGAIN: 'DNS 暂时不可用',
      ECONNREFUSED: '连接被拒绝', ECONNRESET: '连接被重置',
      ETIMEDOUT: '连接超时', UND_ERR_CONNECT_TIMEOUT: '连接超时',
      UND_ERR_SOCKET: '上游连接中断', CERT_HAS_EXPIRED: 'TLS 证书已过期',
      UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS 证书验证失败',
    }
    if (cause.message === 'unexpected redirect') throw failure('PROVIDER_REDIRECT_BLOCKED', requestStage, 'AImAX 返回了重定向，已停止请求以避免向其他地址发送密钥。')
    const detail = networkErrors[cause.code]
    throw failure('PROVIDER_REQUEST_FAILED', requestStage, detail ? `AImAX ${requestStage === 'submit' ? '提交' : '查询'}失败：${detail}（${cause.code}）。` : 'AImAX 请求未完成，未获得 HTTP 响应；尚不能确定是网络故障。')
  }
}
