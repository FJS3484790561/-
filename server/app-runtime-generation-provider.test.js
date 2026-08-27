import test from 'node:test'
import assert from 'node:assert/strict'
import { configuredGenerationProvider, testConfiguredProvider } from './app-runtime.js'

const config = {
  ok: true,
  provider: {
    name: 'image-provider',
    model: 'gpt-image-2',
    endpoint: 'https://provider.example.test/v1/images/edits',
    apiKey: 'super-secret-key',
  },
}
const params = { room: '客厅', theme: '现代简约', scale: '均衡', preferences: { layout: true, light: true } }

function fixture(fetchImpl, timeoutMs = 100, providerConfig = config) {
  const logs = []
  const logger = { info: (...args) => logs.push(args), error: (...args) => logs.push(args) }
  const provider = configuredGenerationProvider({
    adminProviderService: { getEnabledConfig: () => providerConfig },
    fallback: { generate: async () => ({}) },
    fetchImpl,
    logger,
    timeoutMs,
  })
  return { provider, logs }
}

test('uses the image edits multipart request once and returns a URL result', async () => {
  let calls = 0
  let request
  const data = fixture(async (_url, options) => {
    calls += 1
    request = options
    return new Response(JSON.stringify({ data: [{ url: 'https://images.example.test/result.png' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const result = await data.provider.generate({ image: { type: 'image/png', data: Buffer.from('private-original') }, params, traceId: 'generation_safe' })
  assert.equal(calls, 1)
  assert.equal(request.headers['content-type'], undefined)
  assert.equal(request.body.get('model'), 'gpt-image-2')
  assert.equal(request.body.get('size'), '1024x1024')
  assert.equal(request.body.get('n'), '1')
  assert.equal(request.body.get('response_format'), 'url')
  assert.match(request.body.get('prompt'), /客厅/u)
  assert.match(request.body.get('prompt'), /Preserve the original room geometry/u)
  const uploaded = request.body.get('image')
  assert.equal(uploaded.type, 'image/png')
  assert.equal(Buffer.from(await uploaded.arrayBuffer()).toString(), 'private-original')
  assert.deepEqual(result, { effectImage: { url: 'https://images.example.test/result.png', mimeType: 'image/png' } })
  assert.equal(JSON.stringify(data.logs).includes('super-secret-key'), false)
  assert.equal(JSON.stringify(data.logs).includes('private-original'), false)
})

test('uses duoyuanx JSON reference-image protocol for generation', async () => {
  let request
  const duoyuanConfig = { ok: true, provider: { ...config.provider, name: 'duoyuanx', endpoint: 'https://duoyuanx.com/v1/images/generations' } }
  const original = Buffer.from('private-original')
  const data = fixture(async (_url, options) => {
    request = options
    return new Response(JSON.stringify({ data: [{ url: 'https://images.example.test/result.png' }] }), { status: 200 })
  }, 100, duoyuanConfig)
  const result = await data.provider.generate({ image: { type: 'image/png', data: original }, params, traceId: 'generation_duoyuan' })
  const body = JSON.parse(request.body)
  assert.equal(request.headers['content-type'], 'application/json')
  assert.equal(body.model, 'gpt-image-2')
  assert.equal(body.image, original.toString('base64'))
  assert.equal(body.size, '1024x1024')
  assert.equal(body.n, 1)
  assert.equal(body.response_format, 'url')
  assert.match(body.prompt, /Preserve the original room geometry/u)
  assert.deepEqual(result, { effectImage: { url: 'https://images.example.test/result.png', mimeType: 'image/png' } })
  assert.equal(JSON.stringify(data.logs).includes(body.image), false)
})

test('supports base64 Images API output without logging image content', async () => {
  const encoded = Buffer.from('image-bytes').toString('base64')
  const data = fixture(async () => new Response(JSON.stringify({ data: [{ b64_json: encoded }] }), { status: 200 }))
  const result = await data.provider.generate({ image: { type: 'image/jpeg', data: Buffer.from('original') }, params, traceId: 'generation_base64' })
  assert.equal(result.effectImage.url, `data:image/png;base64,${encoded}`)
  assert.equal(JSON.stringify(data.logs).includes(encoded), false)
})

test('reports upstream HTTP failure with status and safe trace diagnostics', async () => {
  const data = fixture(async () => new Response(JSON.stringify({ error: { message: 'token=should-not-log' } }), { status: 429 }))
  await assert.rejects(
    data.provider.generate({ image: { type: 'image/jpeg', data: Buffer.from('original') }, params, traceId: 'generation_http' }),
    (error) => error.code === 'PROVIDER_HTTP_ERROR' && error.stage === 'response' && error.httpStatus === 429,
  )
  const output = JSON.stringify(data.logs)
  assert.match(output, /generation_http/u)
  assert.match(output, /429/u)
  assert.equal(output.includes('should-not-log'), false)
  assert.equal(output.includes('super-secret-key'), false)
})

test('times out once without retrying and emits a safe error code', async () => {
  let calls = 0
  const data = fixture(async (_url, options) => {
    calls += 1
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1000)
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason) }, { once: true })
    })
    return new Response('{}')
  }, 5)
  await assert.rejects(
    data.provider.generate({ image: { type: 'image/jpeg', data: Buffer.from('original') }, params, traceId: 'generation_timeout' }),
    (error) => error.code === 'PROVIDER_TIMEOUT' && error.stage === 'request',
  )
  assert.equal(calls, 1)
  assert.match(JSON.stringify(data.logs), /PROVIDER_TIMEOUT/u)
})

test('save gate tests the same image edit multipart protocol with a safe fixture', async () => {
  const output = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  let request
  const result = await testConfiguredProvider({
    endpoint: 'https://provider.example.test/v1/images/edits',
    model: 'gpt-image-2',
    apiKey: 'save-gate-secret',
    traceId: 'provider_test_safe',
    fetchImpl: async (_url, options) => {
      request = options
      return new Response(JSON.stringify({ data: [{ b64_json: output.toString('base64') }] }), { status: 200 })
    },
  })
  assert.deepEqual(result, { ok: true, httpStatus: 200 })
  assert.equal(request.headers['content-type'], undefined)
  assert.equal(request.body.get('model'), 'gpt-image-2')
  assert.equal(request.body.get('image').type, 'image/png')
  assert.match(request.body.get('prompt'), /preserving its geometry and camera viewpoint/u)
  assert.equal(JSON.stringify([...request.body.keys()]).includes('save-gate-secret'), false)
})

test('save gate uses duoyuanx JSON reference-image protocol', async () => {
  const output = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  let request
  const result = await testConfiguredProvider({
    endpoint: 'https://duoyuanx.com/v1/images/generations',
    model: 'gpt-image-2',
    apiKey: 'duoyuan-save-gate-secret',
    traceId: 'provider_test_duoyuan',
    fetchImpl: async (_url, options) => {
      request = options
      return new Response(JSON.stringify({ data: [{ b64_json: output.toString('base64') }] }), { status: 200 })
    },
  })
  assert.deepEqual(result, { ok: true, httpStatus: 200 })
  const body = JSON.parse(request.body)
  assert.equal(request.headers['content-type'], 'application/json')
  assert.equal(body.model, 'gpt-image-2')
  assert.equal(body.image, output.toString('base64'))
  assert.equal(body.n, 1)
  assert.equal(body.response_format, 'url')
  assert.equal(JSON.stringify(request).includes('duoyuan-save-gate-secret'), true)
  assert.equal(JSON.stringify(body).includes('duoyuan-save-gate-secret'), false)
})
