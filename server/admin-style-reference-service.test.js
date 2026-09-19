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
  const removed = service.remove({ sessionToken: 'admin-token', referenceId: created.styleReference.id })
  assert.equal(removed.deleted, true)
  assert.equal(service.store.references.has(created.styleReference.id), false)
  assert.equal(service.listPublic({ sessionToken: 'user-token' }).styleReferences.length, 0)
})

test('admin style references support duplicate protection, editing and persistent ordering', async () => {
  const { service } = fixture()
  const image = { type: 'image/png', data: Buffer.from([137, 80, 78, 71]) }
  const first = await service.create({ sessionToken: 'admin-token', name: '第一', theme: '北欧', description: '', image })
  const duplicate = await service.create({ sessionToken: 'admin-token', name: '重复', theme: '北欧', description: '', image })
  assert.equal(duplicate.code, 'STYLE_ALREADY_EXISTS')
  const second = await service.create({ sessionToken: 'admin-token', name: '第二', theme: '中古风', description: '', image })
  const updated = await service.update({ sessionToken: 'admin-token', referenceId: first.styleReference.id, name: '更新后的第一', theme: '奶油风', description: '新说明' })
  assert.equal(updated.styleReference.name, '更新后的第一')
  assert.equal(updated.styleReference.theme, '奶油风')
  const reordered = service.reorder({ sessionToken: 'admin-token', referenceIds: [second.styleReference.id, first.styleReference.id] })
  assert.deepEqual(reordered.styleReferences.map((entry) => entry.id), [second.styleReference.id, first.styleReference.id])
  assert.deepEqual(service.listPublic({ sessionToken: 'user-token' }).styleReferences.map((entry) => entry.theme), ['中古风', '奶油风'])
})
