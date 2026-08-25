import assert from 'node:assert/strict'
import test from 'node:test'
import { api, ApiError } from './api.js'

test('API requests use HttpOnly cookie credentials without client session tokens', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, options })
    return new Response(JSON.stringify({ ok: true, user: { id: 'user_1', email: 'user@example.com' }, task: { id: 'generation_1' } }), { status: path === '/api/generations' ? 202 : 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    await api.session()
    await api.createGeneration({ image: { name: 'room.png', type: 'image/png', dataBase64: 'abc' }, params: { room: '客厅' } })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls.every(({ options }) => options.credentials === 'include'), true)
  assert.deepEqual(Object.keys(JSON.parse(calls[1].options.body)).sort(), ['image', 'params'])
  assert.equal(calls[1].options.headers['content-type'], 'application/json')
})

test('API errors expose only the safe server error code and status', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, code: 'UNAUTHORIZED' }), { status: 401, headers: { 'content-type': 'application/json' } })
  try {
    await assert.rejects(api.session(), (error) => error instanceof ApiError && error.code === 'UNAUTHORIZED' && error.status === 401)
  } finally {
    globalThis.fetch = originalFetch
  }
})
