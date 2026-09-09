import test from 'node:test'
import assert from 'node:assert/strict'
import { configuredGenerationProvider, generationPrompt, generationSizeForImage, GENERATION_TIMEOUT_MS, testConfiguredProvider } from './app-runtime.js'
import { DEFAULT_PROVIDER_TIMEOUT_MS } from './generation-service.js'

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

test('production generation allows provider latency with orchestration headroom', () => {
  assert.equal(GENERATION_TIMEOUT_MS, 150_000)
  assert.equal(DEFAULT_PROVIDER_TIMEOUT_MS, 180_000)
  assert.ok(DEFAULT_PROVIDER_TIMEOUT_MS > GENERATION_TIMEOUT_MS)
})

test('keeps the source orientation while staying near the square pixel budget', () => {
  assert.equal(generationSizeForImage({ width: 1600, height: 900 }), '1360x768')
  assert.equal(generationSizeForImage({ width: 900, height: 1600 }), '768x1360')
  assert.equal(generationSizeForImage({ width: 1200, height: 1200 }), '1024x1024')
  assert.equal(generationSizeForImage({}), '1024x1024')
})

test('builds a project-specific image editing prompt with structural and furnishing constraints', () => {
  const prompt = generationPrompt({ room: '客厅', theme: '奶油风', scale: '保真', preferences: { layout: true, storage: true, light: true } })
  assert.match(prompt, /authoritative reference/u)
  assert.match(prompt, /STYLE REFERENCE/u)
  assert.match(prompt, /same design language/u)
  assert.match(prompt, /LOCKED GEOMETRY/u)
  assert.match(prompt, /Cream and warm beige/u)
  assert.match(prompt, /conservative soft-furnishing refresh/u)
  assert.match(prompt, /storage/u)
  assert.match(prompt, /3000K-3500K/u)
  assert.match(prompt, /no blocked doors or walkways/u)
  assert.match(prompt, /Return only the finished edited room image/u)
})

test('defaults to a visibly large transformation and includes custom style direction', () => {
  const prompt = generationPrompt({ room: '客厅', theme: '北欧', customStylePrompt: '浅色木材、低饱和蓝灰、天然织物' })
  assert.match(prompt, /clearly visible full-room transformation/u)
  assert.match(prompt, /sofa, television cabinet, coffee table/u)
  assert.match(prompt, /浅色木材/u)
})

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
  assert.match(request.body.get('prompt'), /LOCKED GEOMETRY/u)
  const uploaded = request.body.get('image')
  assert.equal(uploaded.type, 'image/png')
  assert.equal(Buffer.from(await uploaded.arrayBuffer()).toString(), 'private-original')
  assert.deepEqual(result.effectImage, { url: 'https://images.example.test/result.png', mimeType: 'image/png' })
  assert.ok(Number.isFinite(result.timings.providerMs))
  assert.equal(JSON.stringify(data.logs).includes('super-secret-key'), false)
  assert.equal(JSON.stringify(data.logs).includes('private-original'), false)
})

test('sends the room photo and style reference as separate image parts', async () => {
  let request
  const data = fixture(async (_url, options) => {
    request = options
    return new Response(JSON.stringify({ data: [{ url: 'https://images.example.test/result.png' }] }), { status: 200 })
  })
  await data.provider.generate({
    image: { type: 'image/jpeg', data: Buffer.from('room-photo') },
    params: { ...params, styleReference: { type: 'image/png', data: Buffer.from('style-photo') } },
    traceId: 'generation_two_references',
  })
  const images = request.body.getAll('image')
  assert.equal(images.length, 2)
  assert.equal(Buffer.from(await images[0].arrayBuffer()).toString(), 'room-photo')
  assert.equal(Buffer.from(await images[1].arrayBuffer()).toString(), 'style-photo')
  assert.match(request.body.get('prompt'), /STYLE MATCH PRIORITY/u)
  assert.match(request.body.get('prompt'), /same design language/u)
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
  assert.match(body.prompt, /LOCKED GEOMETRY/u)
  assert.deepEqual(result.effectImage, { url: 'https://images.example.test/result.png', mimeType: 'image/png' })
  assert.ok(Number.isFinite(result.timings.providerMs))
  assert.equal(JSON.stringify(data.logs).includes(body.image), false)
})

test('requests a landscape result for a landscape reference image', async () => {
  let request
  const duoyuanConfig = { ok: true, provider: { ...config.provider, name: 'duoyuanx', endpoint: 'https://duoyuanx.com/v1/images/generations' } }
  const data = fixture(async (_url, options) => {
    request = options
    return new Response(JSON.stringify({ data: [{ url: 'https://images.example.test/result.png' }] }), { status: 200 })
  }, 100, duoyuanConfig)
  await data.provider.generate({ image: { type: 'image/png', width: 1600, height: 900, data: Buffer.from('private-original') }, params, traceId: 'generation_landscape' })
  assert.equal(JSON.parse(request.body).size, '1360x768')
})

test('reduces only duoyuanx dual-reference output pixels while preserving source orientation', async () => {
  let request
  const duoyuanConfig = { ok: true, provider: { ...config.provider, name: 'duoyuanx', endpoint: 'https://duoyuanx.com/v1/images/generations' } }
  const data = fixture(async (_url, options) => {
    request = options
    return new Response(JSON.stringify({ data: [{ url: 'https://images.example.test/result.png' }] }), { status: 200 })
  }, 100, duoyuanConfig)
  await data.provider.generate({
    image: { type: 'image/jpeg', width: 960, height: 640, data: Buffer.from('private-original') },
    params: { ...params, styleReference: { type: 'image/png', data: Buffer.from('private-style') } },
    traceId: 'generation_duoyuan_dual_reference',
  })
  const body = JSON.parse(request.body)
  assert.equal(body.size, '1024x688')
  assert.equal(body.image.length, 2)
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
  assert.equal(result.ok, true)
  assert.equal(result.httpStatus, 200)
  assert.equal(result.protocol, 'multipart-image-edit')
  assert.ok(result.elapsedMs >= 0)
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
  assert.equal(result.ok, true)
  assert.equal(result.httpStatus, 200)
  assert.equal(result.protocol, 'json-reference-image')
  assert.ok(result.elapsedMs >= 0)
  const body = JSON.parse(request.body)
  assert.equal(request.headers['content-type'], 'application/json')
  assert.equal(body.model, 'gpt-image-2')
  assert.equal(Array.isArray(body.image), true)
  assert.equal(body.image.length, 2)
  assert.equal(body.image[0], body.image[1])
  assert.equal(body.n, 1)
  assert.equal(body.response_format, 'url')
  assert.equal(JSON.stringify(request).includes('duoyuan-save-gate-secret'), true)
  assert.equal(JSON.stringify(body).includes('duoyuan-save-gate-secret'), false)
})

test('save gate returns redacted upstream diagnostics without exposing credentials or image data', async () => {
  const result = await testConfiguredProvider({
    endpoint: 'https://duoyuanx.com/v1/images/generations',
    model: 'gpt-image-2',
    apiKey: 'diagnostic-secret',
    traceId: 'provider_test_diagnostic',
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'invalid_image', message: 'image is too small; Bearer should-not-leak' } }), { status: 400 }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.httpStatus, 400)
  assert.equal(result.protocol, 'json-reference-image')
  assert.equal(result.upstreamCode, 'invalid_image')
  assert.equal(result.upstreamMessage, 'image is too small; Bearer [REDACTED]')
  assert.equal(JSON.stringify(result).includes('should-not-leak'), false)
  assert.equal(JSON.stringify(result).includes('diagnostic-secret'), false)
})

test('save gate classifies abort code 23 as a provider timeout', async () => {
  const result = await testConfiguredProvider({
    endpoint: 'https://duoyuanx.com/v1/images/generations',
    model: 'gpt-image-2',
    apiKey: 'timeout-secret',
    traceId: 'provider_test_timeout',
    timeoutMs: 5,
    fetchImpl: async () => { const error = new Error('aborted'); error.name = 'AbortError'; error.code = 23; throw error },
  })
  assert.equal(result.code, 'PROVIDER_TIMEOUT')
  assert.equal(result.stage, 'request')
  assert.equal(result.protocol, 'json-reference-image')
})
