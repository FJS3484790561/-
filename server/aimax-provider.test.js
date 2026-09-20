import test from 'node:test'
import assert from 'node:assert/strict'
import { runAimax, isAimax } from './aimax-provider.js'
import { testConfiguredProvider, configuredGenerationProvider } from './app-runtime.js'
const options = { endpoint: 'https://api.aimaxa.cn/v1/images/generations', model: 'gpt-image-2.5', apiKey: 'test-secret', traceId: 'safe-trace', imageUrl: 'https://storage.example/original.png?signature=private', prompt: '保持原图结构', pollMs: 1, timeoutMs: 1000 }
const json = (data) => Response.json({ code: 200, data })
test('AImAX submits Sunburst JSON once, polls with auth, and reads works asset URL', async () => {
  const calls = []
  const result = await runAimax({ ...options, fetchImpl: async (url, init) => {
    calls.push({ url, init })
    if (calls.length === 1) return json({ task_id: 'task_abc', status: 'submitted' })
    if (calls.length === 2) return json({ task_id: 'task_abc', status: 'processing', works: [] })
    return json({ task_id: 'task_abc', status: 'succeeded', works: [{ asset_url: 'https://images.example/result.png' }] })
  } })
  assert.equal(result.url, 'https://images.example/result.png')
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: options.model, version: 'sunburst', prompt: options.prompt, size: 'auto', resolution: '1k', images: [options.imageUrl] })
  assert.equal(calls.filter(c => c.init.method === 'POST').length, 1)
  assert.equal(calls[1].url, 'https://api.aimaxa.cn/v1/tasks/task_abc')
  assert.equal(calls[1].init.headers.authorization, 'Bearer test-secret')
})
test('AImAX HTTP 200 failed task is failure and does not expose upstream secret', async () => {
  await assert.rejects(runAimax({ ...options, fetchImpl: async () => json({ task_id: 'task_fail', status: 'failed', fail_reason: 'test-secret' }) }), e => e.code === 'PROVIDER_TASK_FAILED' && !e.message.includes('test-secret'))
})
test('AImAX malformed success and missing reference fail without text-to-image fallback', async () => {
  await assert.rejects(runAimax({ ...options, imageUrl: undefined, fetchImpl: () => { throw Error('must not submit') } }), { code: 'REFERENCE_IMAGE_UNAVAILABLE' })
  await assert.rejects(runAimax({ ...options, fetchImpl: async () => json({ task_id: 'task_empty', status: 'succeeded', works: [] }) }), { code: 'INVALID_PROVIDER_RESPONSE' })
  assert.equal(isAimax('https://other.example/v1/images/generations', options.model), false)
})
test('AImAX deadline stops polling without resubmitting', async () => {
  let submissions = 0
  await assert.rejects(runAimax({ ...options, timeoutMs: 10, pollMs: 30, fetchImpl: async () => { submissions++; return json({ task_id: 'task_wait', status: 'processing' }) } }), { code: 'PROVIDER_TIMEOUT' })
  assert.equal(submissions, 1)
})
test('AImAX save gate uses signed fixture and validates final image, not just task id', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  let stored = false
  const objectStorage = { put: async () => { stored = true }, signedReadUrl: async () => options.imageUrl }
  const result = await testConfiguredProvider({ ...options, objectStorage, fetchImpl: async (url, init) => {
    if (init?.method === 'POST') return json({ task_id: 'task_gate', status: 'submitted' })
    if (String(url).includes('/v1/tasks/')) return json({ task_id: 'task_gate', status: 'succeeded', works: [{ asset_url: 'https://images.example/result.png' }] })
    return new Response(png)
  } })
  assert.equal(stored, true)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.protocol, 'aimax-async-reference-image')
})
test('formal generation passes SOP and original signed URL through async adapter', async () => {
  const provider = configuredGenerationProvider({ adminProviderService: { getEnabledConfig: () => ({ ok: true, provider: options }) }, conversationProvider: { analyze: async () => ({ prompt: options.prompt, providerMs: 1 }) }, logger: {}, fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body)
    assert.deepEqual(body.images, [options.imageUrl])
    assert.equal(body.prompt, options.prompt)
    return json({ task_id: 'task_done', status: 'succeeded', works: [{ asset_url: 'https://images.example/result.png' }] })
  } })
  assert.equal(provider.needsReferenceUrl(), true)
  const result = await provider.generate({ image: { type: 'image/png', data: Buffer.from('original') }, referenceImageUrl: options.imageUrl, params: {}, traceId: 'formal-test' })
  assert.equal(result.effectImage.url, 'https://images.example/result.png')
})
