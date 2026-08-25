import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE app_users (
        email TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL UNIQUE,
        value_json TEXT NOT NULL
      );
      CREATE TABLE auth_sessions (
        token_digest TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(entity_id) ON DELETE CASCADE,
        value_json TEXT NOT NULL
      );
      CREATE TABLE password_reset_tokens (
        token_digest TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(entity_id) ON DELETE CASCADE,
        value_json TEXT NOT NULL
      );
      CREATE TABLE initialized_credit_users (
        user_id TEXT PRIMARY KEY REFERENCES app_users(entity_id) ON DELETE CASCADE
      );
      CREATE TABLE credit_lot_groups (
        user_id TEXT PRIMARY KEY REFERENCES app_users(entity_id) ON DELETE CASCADE,
        value_json TEXT NOT NULL
      );
      CREATE TABLE credit_reservations (
        reservation_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(entity_id) ON DELETE CASCADE,
        value_json TEXT NOT NULL
      );
      CREATE TABLE credit_operations (
        operation_key TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL UNIQUE REFERENCES credit_reservations(reservation_id) ON DELETE CASCADE,
        value_json TEXT NOT NULL
      );
      CREATE TABLE payment_orders (
        order_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(entity_id) ON DELETE RESTRICT,
        value_json TEXT NOT NULL
      );
      CREATE TABLE payment_events (
        event_id TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
      CREATE TABLE generation_tasks (
        task_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(entity_id) ON DELETE CASCADE,
        value_json TEXT NOT NULL
      );
      CREATE TABLE works (
        work_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(entity_id) ON DELETE CASCADE,
        value_json TEXT NOT NULL
      );
      CREATE TABLE provider_configs (
        provider_id TEXT PRIMARY KEY,
        provider_name TEXT NOT NULL UNIQUE,
        value_json TEXT NOT NULL
      );
      CREATE TABLE provider_audit (
        audit_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES provider_configs(provider_id) ON DELETE CASCADE,
        value_json TEXT NOT NULL
      );
      CREATE TABLE stored_objects (
        object_key TEXT PRIMARY KEY,
        owner_id TEXT REFERENCES app_users(entity_id) ON DELETE CASCADE,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
        created_at INTEGER NOT NULL,
        metadata_json TEXT NOT NULL,
        value_json TEXT NOT NULL
      );
    `,
  },
]

function applyMigrations(database) {
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const applied = new Set(database.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version))
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    database.transaction(() => {
      database.exec(migration.sql)
      database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, Date.now())
    })()
  }
}

export function openSqliteDatabase({ filename, readonly = false } = {}) {
  if (!filename) throw new Error('SQLite filename is required')
  const absolute = resolve(filename)
  if (!readonly) mkdirSync(dirname(absolute), { recursive: true })
  const database = new Database(absolute, { readonly, fileMustExist: readonly })
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  if (!readonly) {
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = FULL')
    applyMigrations(database)
  }
  return database
}

export function verifySqliteDatabase(database) {
  const integrity = database.pragma('integrity_check', { simple: true })
  const foreignKeys = database.pragma('foreign_key_check')
  const requiredTables = ['app_users', 'auth_sessions', 'credit_lot_groups', 'credit_reservations', 'payment_orders', 'generation_tasks', 'works', 'provider_configs', 'stored_objects']
  const present = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name))
  const missingTables = requiredTables.filter((name) => !present.has(name))
  const ledgerIssues = []
  if (present.has('credit_lot_groups') && present.has('credit_reservations')) {
    const groups = database.prepare('SELECT user_id, value_json FROM credit_lot_groups').all()
    const lots = new Map()
    for (const group of groups) {
      for (const lot of JSON.parse(group.value_json)) {
        lots.set(lot.id, lot)
        if (lot.userId !== group.user_id || lot.amount < 0 || lot.consumed < 0 || lot.reserved < 0 || lot.consumed + lot.reserved > lot.amount) ledgerIssues.push(`invalid-lot:${lot.id}`)
      }
    }
    const expectedReserved = new Map()
    for (const row of database.prepare('SELECT value_json FROM credit_reservations').all()) {
      const reservation = JSON.parse(row.value_json)
      if (reservation.status !== 'reserved') continue
      for (const allocation of reservation.allocations) expectedReserved.set(allocation.lotId, (expectedReserved.get(allocation.lotId) ?? 0) + allocation.quantity)
    }
    for (const [lotId, lot] of lots) if ((expectedReserved.get(lotId) ?? 0) !== lot.reserved) ledgerIssues.push(`reservation-mismatch:${lotId}`)
    for (const lotId of expectedReserved.keys()) if (!lots.has(lotId)) ledgerIssues.push(`missing-lot:${lotId}`)
  }
  return {
    ok: integrity === 'ok' && foreignKeys.length === 0 && missingTables.length === 0 && ledgerIssues.length === 0,
    integrity,
    foreignKeyViolations: foreignKeys.length,
    missingTables,
    ledgerIssues,
  }
}

export async function backupSqliteDatabase(database, destination) {
  const absolute = resolve(destination)
  mkdirSync(dirname(absolute), { recursive: true })
  await database.backup(absolute)
  const backup = openSqliteDatabase({ filename: absolute, readonly: true })
  try {
    const verification = verifySqliteDatabase(backup)
    if (!verification.ok) throw new Error('SQLite backup verification failed')
    return { destination: absolute, verification }
  } finally {
    backup.close()
  }
}

export const sqliteSchemaVersion = MIGRATIONS.at(-1).version
