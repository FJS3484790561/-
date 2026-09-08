import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveClientAddress } from './http-server.js'

test('trusts X-Real-IP only from the local reverse proxy', () => {
  assert.equal(resolveClientAddress({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-real-ip': '203.0.113.8' } }), '203.0.113.8')
  assert.equal(resolveClientAddress({ socket: { remoteAddress: '198.51.100.9' }, headers: { 'x-real-ip': '203.0.113.8' } }), '198.51.100.9')
})

test('rejects malformed proxy addresses and keeps a stable fallback', () => {
  assert.equal(resolveClientAddress({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '203.0.113.8, 198.51.100.9' } }), '127.0.0.1')
  assert.equal(resolveClientAddress({ socket: {}, headers: {} }), 'unknown')
})
