import test from 'node:test'
import assert from 'node:assert/strict'
import { AdminStyleReferenceService, MemoryAdminStyleReferenceStore } from './admin-style-reference-service.js'

function fixture() {
  const users = new Map([
    ['admin-token', { id: 'admin-1', email: 'admin@example.com' }],
    ['user-token', { id: 'user-1', email: 'user@example.com' }],
  ])
  const objects = new Map()
  const objectStorage = {
    async put(input) { objects.set(input.key, { ...input, sizeBytes: input.body.length }); return { key: input.key, mimeType: input.mimeType } },
  }
  const authService = { getSession: (token) => users.get(token) }
  return { service: new AdminStyleReferenceService({ authService, store: new MemoryAdminStyleReferenceStore(), objectStorage, isAdmin: (user) => user.email === 'admin@example.com' }), objects }
}

test('admin style references are separate public display assets', async () => {
  const { service, objects } = fixture()
  const image = { type: 'image/png', data: Buffer.from([137, 80, 78, 71]) }
  const created = await service.create({ sessionToken: 'admin-token', name: '暖木客厅', theme: '现代简约', description: '给用户看的参考', image })
  assert.equal(created.ok, true)
  assert.equal(objects.size, 1)
  assert.equal(service.list({ sessionToken: 'user-token' }).code, 'FORBIDDEN')
  assert.equal(service.listPublic({ sessionToken: 'user-token' }).styleReferences.length, 1)
  const disabled = service.remove({ sessionToken: 'admin-token', referenceId: created.styleReference.id })
  assert.equal(disabled.styleReference.enabled, false)
  assert.equal(service.listPublic({ sessionToken: 'user-token' }).styleReferences.length, 0)
})
