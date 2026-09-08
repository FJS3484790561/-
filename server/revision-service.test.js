import test from 'node:test'
import assert from 'node:assert/strict'
import { createAppRuntime, generationPrompt } from './app-runtime.js'

const jpeg = (index) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, index])
const image = { data: jpeg(0), type: 'image/jpeg', width: 1600, height: 900 }
const params = { room: '客厅', theme: '中古风', styleReference: image, userPrompt: '保留绿色沙发' }
async function fixture({ storage = false } = {}) {
  const records = new Map(); const inputs = []; let failure = false
  const objectStorage = storage ? {
    async put(record) { records.set(record.key, record); return { ...record, sizeBytes: record.body.length } },
    metadataFor(key) { return records.get(key) },
    async get({ key }) { return records.get(key) },
  } : null
  const runtime = createAppRuntime({ objectStorage, logger: {}, generationProvider: { generate: async (input) => {
    inputs.push(input); if (failure) throw new Error('test provider failure')
    return { effectImage: { url: `data:image/jpeg;base64,${jpeg(inputs.length).toString('base64')}`, mimeType: 'image/jpeg' } }
  } } })
  await runtime.authService.provisionUser({ email: 'one@example.com', password: 'test-password' })
  const { sessionToken } = await runtime.authService.login({ email: 'one@example.com', password: 'test-password' })
  runtime.creditLedger.grant({ sessionToken, amount: 20 })
  const generate = async () => { const created = await runtime.generationService.createGeneration({ sessionToken, image, params }); return runtime.generationService.waitForGeneration(created.task.id) }
  const revise = async (taskId, prompt = '方桌换圆桌') => {
    const created = await runtime.generationService.createRevision({ sessionToken, taskId, prompt, styleReference: image })
    return created.ok ? runtime.generationService.waitForGeneration(created.task.id) : created
  }
  return { runtime, inputs, sessionToken, generate, revise, fail: () => { failure = true } }
}

for (const storage of [false, true]) test(`continuous revision reads parent result, preserves original and supports branching (storage=${storage})`, async () => {
  const f = await fixture({ storage })
  const first = await f.generate()
  let current = first
  for (let i = 1; i <= 4; i++) {
    const next = await f.revise(current.id)
    assert.equal(next.status, 'succeeded')
    assert.equal(next.parentTaskId, current.id); assert.equal(next.rootTaskId, first.id)
    assert.deepEqual(f.inputs.at(-1).image.data, jpeg(i))
    assert.deepEqual(next.result.original, first.result.original)
    current = next
  }
  const branch = await f.revise(first.id, '只修改窗帘')
  assert.equal(branch.parentTaskId, first.id)
  assert.deepEqual(f.inputs.at(-1).image.data, jpeg(1))
  assert.equal(f.runtime.generationService.getGeneration({ sessionToken: f.sessionToken, taskId: current.id }).task.status, 'succeeded')
})

test('revision rejects another owner, invalid prompts and unavailable parent without Provider or quota mutations', async () => {
  const f = await fixture(); const first = await f.generate()
  await f.runtime.authService.provisionUser({ email: 'other@example.com', password: 'test-password' })
  const other = await f.runtime.authService.login({ email: 'other@example.com', password: 'test-password' })
  assert.equal((await f.runtime.generationService.createRevision({ sessionToken: other.sessionToken, taskId: first.id, prompt: 'change' })).code, 'NOT_FOUND')
  assert.equal((await f.revise(first.id, '')).code, 'VALIDATION_ERROR')
  assert.equal((await f.revise(first.id, 'x'.repeat(2001))).code, 'VALIDATION_ERROR')
  assert.equal((await f.revise('missing')).code, 'NOT_FOUND')
  assert.equal(f.inputs.length, 1)
})

test('revision succeeds for one credit and failure releases reservation while retaining parent', async () => {
  const f = await fixture(); const first = await f.generate()
  const balance = () => f.runtime.creditLedger.getBalance({ sessionToken: f.sessionToken }).available
  const initial = balance()
  const next = await f.revise(first.id)
  assert.equal(balance(), initial - 1)
  f.fail(); const failed = await f.revise(next.id)
  assert.equal(failed.status, 'failed'); assert.equal(balance(), initial - 1)
  assert.equal(f.runtime.generationService.getGeneration({ sessionToken: f.sessionToken, taskId: next.id }).task.status, 'succeeded')
})

test('initial prompt incorporates user requirements while revision does not invoke full redesign', () => {
  const prompt = generationPrompt(params)
  assert.ok(prompt.includes('保留绿色沙发')); assert.ok(prompt.includes('Mid-century'))
  assert.ok(generationPrompt({ ...params, theme: '侘寂风' }).includes('Wabi-sabi'))
  const edit = generationPrompt({ ...params, editPrompt: '只换圆桌' })
  assert.ok(edit.includes('CURRENT accepted design')); assert.ok(edit.includes('只换圆桌'))
  assert.equal(edit.includes('DEFAULT TRANSFORMATION SCOPE'), false)
})

test('revision timeout releases credits and late result does not replace an accepted parent', async () => {
  const f = await fixture(); const first = await f.generate()
  const before = f.runtime.creditLedger.getBalance({ sessionToken: f.sessionToken }).available
  let finish
  f.runtime.generationService.providerTimeoutMs = 5
  f.runtime.generationService.providers.register('default', { generate: () => new Promise((resolve) => { finish = resolve }) })
  const failed = await f.revise(first.id)
  assert.equal(failed.error.code, 'GENERATION_TIMEOUT')
  finish({ effectImage: { url: `data:image/jpeg;base64,${jpeg(9).toString('base64')}`, mimeType: 'image/jpeg' } })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(f.runtime.generationService.getGeneration({ sessionToken: f.sessionToken, taskId: failed.id }).task.status, 'failed')
  assert.equal(f.runtime.generationService.getGeneration({ sessionToken: f.sessionToken, taskId: first.id }).task.status, 'succeeded')
  assert.equal(f.runtime.creditLedger.getBalance({ sessionToken: f.sessionToken }).available, before)
})
