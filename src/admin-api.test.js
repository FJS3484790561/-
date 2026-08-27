import assert from 'node:assert/strict'
import test from 'node:test'
import { adminApi, ApiError } from './admin-api.js'

test('admin client uses only the approved HTTP routes and same-origin cookies', async (t) => {
  const calls = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options })
    return new Response(JSON.stringify({ ok: true, providers: [], provider: {}, audit: [], redemptionCodes: [], redemptionCode: {}, code: 'ROOM-2345-6789-ABCD' }), { headers: { 'content-type': 'application/json' } })
  }
  t.after(() => { globalThis.fetch = previousFetch })
  await adminApi.listProviders()
  await adminApi.createProvider({ name: 'safe', endpoint: 'https://example.invalid', model: 'v1', apiKey: 'input-only' })
  await adminApi.updateProvider('provider/a', { model: 'v2' })
  await adminApi.setProviderEnabled('provider/a', true)
  await adminApi.listAudit('provider/a')
  await adminApi.listRedemptionCodes()
  await adminApi.createRedemptionCode({ credits: 5, maxRedemptions: 10 })
  assert.deepEqual(calls.map((call) => call.path), [
    '/api/admin/providers',
    '/api/admin/providers',
    '/api/admin/providers/provider%2Fa',
    '/api/admin/providers/provider%2Fa/enabled',
    '/api/admin/providers/provider%2Fa/audit',
    '/api/admin/redemption-codes',
    '/api/admin/redemption-codes',
  ])
  assert.ok(calls.every((call) => call.options.credentials === 'same-origin'))
  assert.equal(calls.some((call) => call.options.body?.includes('sessionToken')), false)
  assert.equal(calls.some((call) => call.options.body?.includes('providerId')), false)
})

test('admin client returns structured safe errors', async (t) => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, code: 'PROVIDER_TEST_FAILED', stage: 'response', httpStatus: 401, traceId: 'provider_test_safe' }), { status: 502, headers: { 'content-type': 'application/json' } })
  t.after(() => { globalThis.fetch = previousFetch })
  await assert.rejects(adminApi.listProviders(), (error) => error instanceof ApiError && error.status === 502 && error.code === 'PROVIDER_TEST_FAILED' && error.stage === 'response' && error.httpStatus === 401 && error.traceId === 'provider_test_safe')
})
