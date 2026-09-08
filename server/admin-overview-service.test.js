import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteStores } from './persistence/sqlite-stores.js'
import { AdminOverviewService } from './admin-overview-service.js'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'admin-overview-'))
  const stores = createSqliteStores({ filename: join(directory, 'app.sqlite') })
  const now = Date.UTC(2026, 8, 7, 4, 0, 0)
  const admin = { id: 'admin_1', email: 'admin@example.com' }
  const user = { id: 'user_1', email: 'user@example.com' }
  stores.database.prepare('INSERT INTO app_users (email, entity_id, value_json) VALUES (?, ?, ?)').run(admin.email, admin.id, JSON.stringify({ ...admin, createdAt: now - 2 * 86400000 }))
  stores.database.prepare('INSERT INTO app_users (email, entity_id, value_json) VALUES (?, ?, ?)').run(user.email, user.id, JSON.stringify({ ...user, createdAt: now - 10 * 86400000 }))
  stores.database.prepare('INSERT INTO generation_tasks (task_id, user_id, value_json) VALUES (?, ?, ?)').run('task_1', user.id, JSON.stringify({ id: 'task_1', userId: user.id, status: 'succeeded', createdAt: now - 1000 }))
  stores.database.prepare('INSERT INTO generation_tasks (task_id, user_id, value_json) VALUES (?, ?, ?)').run('task_2', user.id, JSON.stringify({ id: 'task_2', userId: user.id, status: 'failed', createdAt: now - 3 * 86400000 }))
  stores.database.prepare('INSERT INTO generation_tasks (task_id, user_id, value_json) VALUES (?, ?, ?)').run('task_3', user.id, JSON.stringify({ id: 'task_3', userId: user.id, status: 'running', createdAt: now - 1000 }))
  stores.database.prepare('INSERT INTO works (work_id, user_id, value_json) VALUES (?, ?, ?)').run('work_1', user.id, JSON.stringify({ id: 'work_1', userId: user.id, createdAt: now - 1000, hugeImagePayload: 'must-not-be-returned' }))
  stores.database.prepare('INSERT INTO provider_configs (provider_id, provider_name, value_json) VALUES (?, ?, ?)').run('provider_1', 'primary', JSON.stringify({ id: 'provider_1', name: 'primary', enabled: true }))
  stores.database.prepare('INSERT INTO provider_configs (provider_id, provider_name, value_json) VALUES (?, ?, ?)').run('provider_2', 'backup', JSON.stringify({ id: 'provider_2', name: 'backup', enabled: false }))
  stores.database.prepare('INSERT INTO redemption_codes (code_digest, code_id, value_json) VALUES (?, ?, ?)').run('digest_1', 'code_1', JSON.stringify({ id: 'code_1', redeemedCount: 1, maxRedemptions: 3 }))
  stores.database.prepare('INSERT INTO stored_objects (object_key, owner_id, mime_type, size_bytes, created_at, metadata_json, value_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run('object_1', user.id, 'image/png', 2048, now, '{}', '{}')
  stores.database.prepare('INSERT INTO credit_lot_groups (user_id, value_json) VALUES (?, ?)').run(user.id, JSON.stringify([{ id: 'lot_1', amount: 10, consumed: 2, reserved: 1, expiresAt: now + 86400000 }, { id: 'lot_2', amount: 99, consumed: 0, reserved: 0, expiresAt: now - 1 }]))
  stores.credits.journal.append({ id: 'grant_1', idempotencyKey: 'grant_1', userId: user.id, type: 'grant', amount: 109, occurredAt: now })
  const authService = { getSession: (token) => token === 'admin-token' ? admin : token === 'user-token' ? user : null }
  const service = new AdminOverviewService({ database: stores.database, authService, isAdmin: (candidate) => candidate.email === admin.email, clock: () => now })
  return { service, stores, directory }
}

test('requires authentication and admin permission', () => {
  const { service, stores, directory } = fixture()
  try {
    assert.deepEqual(service.get({}), { ok: false, code: 'UNAUTHORIZED' })
    assert.deepEqual(service.get({ sessionToken: 'user-token' }), { ok: false, code: 'FORBIDDEN' })
  } finally { stores.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('aggregates overview without returning historical payloads', () => {
  const { service, stores, directory } = fixture()
  try {
    const result = service.get({ sessionToken: 'admin-token' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.overview.users, { total: 2, today: 0, last7Days: 1 })
    assert.deepEqual(result.overview.generations, { total: 3, today: 2, last7Days: 3, succeeded: 1, failed: 1, running: 1, successRate: 50 })
    assert.deepEqual(result.overview.works, { total: 1, today: 1, last7Days: 1 })
    assert.deepEqual(result.overview.providers, { total: 2, enabled: 1, disabled: 1 })
    assert.deepEqual(result.overview.redemptionCodes, { total: 1, redemptions: 1, remaining: 2 })
    assert.deepEqual(result.overview.credits, { available: 7, reserved: 1, consumed: 2, granted: 109 })
    assert.deepEqual(result.overview.storage, { objects: 1, bytes: 2048 })
    assert.equal(JSON.stringify(result).includes('must-not-be-returned'), false)
    assert.equal(result.overview.timeZone, 'Asia/Shanghai')
  } finally { stores.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('missing database is unavailable, never a fabricated empty overview', () => {
  const service = new AdminOverviewService({ authService: { getSession: () => ({ id: 'admin' }) }, isAdmin: () => true })
  assert.deepEqual(service.get(), { ok: false, code: 'OVERVIEW_UNAVAILABLE' })
})

test('empty tables return zeros and no success rate without writing data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'admin-overview-empty-'))
  const stores = createSqliteStores({ filename: join(directory, 'app.sqlite') })
  try {
    const service = new AdminOverviewService({ database: stores.database, authService: { getSession: () => ({ id: 'admin' }) }, isAdmin: () => true, clock: () => 100 })
    const before = stores.database.prepare('SELECT total_changes() AS count').get().count
    const { overview } = service.get()
    assert.deepEqual(overview.users, { total: 0, today: 0, last7Days: 0 })
    assert.deepEqual(overview.generations, { total: 0, today: 0, last7Days: 0, succeeded: 0, failed: 0, running: 0, successRate: null })
    for (const group of ['works', 'credits', 'redemptionCodes', 'providers', 'storage']) {
      assert.ok(Object.values(overview[group]).every((value) => value === 0))
    }
    assert.equal(overview.generatedAt, 100)
    assert.equal(stores.database.prepare('SELECT total_changes() AS count').get().count, before)
  } finally { stores.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('uses seven Shanghai calendar days, excludes future timestamps and expires credits exactly at the cutoff', () => {
  const { service, stores, directory } = fixture()
  try {
    const now = service.clock()
    const today = Date.parse('2026-09-07T00:00:00+08:00')
    const firstDay = today - 6 * 86400000
    const times = [today, today - 1, firstDay, firstDay - 1, now + 1]
    times.forEach((createdAt, i) => stores.works.works.set(`boundary_${i}`, { userId: 'user_1', createdAt }))
    stores.credits.lots.set('user_1', [{ amount: 100, consumed: 0, reserved: 1, expiresAt: now }])
    const data = service.get({ sessionToken: 'admin-token' }).overview
    assert.deepEqual(data.works, { total: 6, today: 2, last7Days: 4 })
    assert.equal(data.credits.available, 0)
    assert.equal(data.credits.reserved, 1)
  } finally { stores.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('keeps multi-megabyte image and secret fields out of results and sees refreshed counts', () => {
  const { service, stores, directory } = fixture()
  try {
    stores.works.works.set('large-work', { userId: 'user_1', createdAt: service.clock(), original: 'image-payload-marker'.repeat(200000) })
    stores.providers.configs.set('private-provider', { name: 'private-provider', enabled: false, encryptedApiKey: 'secret-marker' })
    const before = stores.database.prepare('SELECT total_changes() AS count').get().count
    const result = service.get({ sessionToken: 'admin-token' })
    assert.equal(result.overview.works.total, 2)
    assert.equal(result.overview.providers.total, 3)
    const body = JSON.stringify(result)
    assert.ok(body.length < 2000)
    for (const forbidden of ['image-payload-marker', 'secret-marker', 'user@example.com', 'userId', 'encryptedApiKey']) assert.equal(body.includes(forbidden), false)
    assert.equal(stores.database.prepare('SELECT total_changes() AS count').get().count, before)
  } finally { stores.close(); rmSync(directory, { recursive: true, force: true }) }
})
