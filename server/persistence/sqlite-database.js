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
  {
    version: 2,
    sql: `
      ALTER TABLE credit_operations RENAME TO credit_reservation_operations;
      CREATE TABLE credit_operations (
        operation_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES app_users(entity_id) ON DELETE RESTRICT,
        operation_type TEXT NOT NULL CHECK(operation_type IN ('grant', 'reserve', 'settle', 'release')),
        amount INTEGER NOT NULL CHECK(amount > 0),
        occurred_at INTEGER NOT NULL,
        value_json TEXT NOT NULL
      );
      CREATE INDEX credit_operations_user_time ON credit_operations(user_id, occurred_at, operation_id);
    `,
    backfill(database) {
      const insert = database.prepare(`
        INSERT OR IGNORE INTO credit_operations
          (operation_id, idempotency_key, user_id, operation_type, amount, occurred_at, value_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      const append = (entry) => insert.run(entry.id, entry.idempotencyKey, entry.userId, entry.type, entry.amount, entry.occurredAt, JSON.stringify(entry))
      for (const group of database.prepare('SELECT user_id, value_json FROM credit_lot_groups').all()) {
        for (const lot of JSON.parse(group.value_json)) {
          append({ id: `migration_grant_${lot.id}`, idempotencyKey: `migration:grant:${lot.id}`, userId: group.user_id, type: 'grant', amount: lot.amount, lotId: lot.id, source: lot.source, expiresAt: lot.expiresAt, occurredAt: lot.createdAt })
        }
      }
      for (const row of database.prepare('SELECT reservation_id, user_id, value_json FROM credit_reservations').all()) {
        const reservation = JSON.parse(row.value_json)
        const common = { userId: row.user_id, amount: reservation.amount, reservationId: row.reservation_id, allocations: reservation.allocations }
        append({ id: `migration_reserve_${row.reservation_id}`, idempotencyKey: `migration:reserve:${row.reservation_id}`, type: 'reserve', occurredAt: reservation.createdAt, ...common })
        if (reservation.status === 'settled') append({ id: `migration_settle_${row.reservation_id}`, idempotencyKey: `migration:settle:${row.reservation_id}`, type: 'settle', occurredAt: reservation.settledAt ?? reservation.createdAt, ...common })
        if (reservation.status === 'released') append({ id: `migration_release_${row.reservation_id}`, idempotencyKey: `migration:release:${row.reservation_id}`, type: 'release', occurredAt: reservation.releasedAt ?? reservation.createdAt, ...common })
      }
    },
  },
  {
    version: 3,
    sql: `
      CREATE TABLE redemption_codes (
        code_digest TEXT PRIMARY KEY,
        code_id TEXT NOT NULL UNIQUE,
        value_json TEXT NOT NULL
      );
      CREATE TABLE redemption_code_uses (
        redemption_key TEXT PRIMARY KEY,
        code_id TEXT NOT NULL REFERENCES redemption_codes(code_id) ON DELETE RESTRICT,
        user_id TEXT NOT NULL REFERENCES app_users(entity_id) ON DELETE RESTRICT,
        value_json TEXT NOT NULL,
        UNIQUE(code_id, user_id)
      );
      CREATE INDEX redemption_code_uses_code ON redemption_code_uses(code_id);
    `,
  },
]

MIGRATIONS.push({ version: 4, sql: `CREATE TABLE user_styles (style_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(entity_id) ON DELETE CASCADE, value_json TEXT NOT NULL); CREATE INDEX user_styles_user ON user_styles(user_id);` })
MIGRATIONS.push({ version: 5, sql: `CREATE TABLE registration_challenges (challenge_key TEXT PRIMARY KEY, value_json TEXT NOT NULL);` })
MIGRATIONS.push({ version: 6, sql: `CREATE TABLE user_feedback (feedback_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(entity_id) ON DELETE CASCADE, value_json TEXT NOT NULL); CREATE INDEX user_feedback_user ON user_feedback(user_id);` })
MIGRATIONS.push({ version: 7, sql: `CREATE TABLE admin_style_references (style_reference_id TEXT PRIMARY KEY, value_json TEXT NOT NULL);` })
const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1).version

function applyMigrations(database, targetVersion = LATEST_SCHEMA_VERSION) {
  if (!Number.isInteger(targetVersion) || targetVersion < 1 || targetVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported SQLite schema target version: ${targetVersion}`)
  }
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const applied = new Set(database.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version))
  for (const migration of MIGRATIONS) {
    if (migration.version > targetVersion) break
    if (applied.has(migration.version)) continue
    database.transaction(() => {
      database.exec(migration.sql)
      migration.backfill?.(database)
      database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, Date.now())
    })()
  }
}

export function openSqliteDatabase({ filename, readonly = false, targetVersion = LATEST_SCHEMA_VERSION } = {}) {
  if (!filename) throw new Error('SQLite filename is required')
  const absolute = resolve(filename)
  if (!readonly) mkdirSync(dirname(absolute), { recursive: true })
  const database = new Database(absolute, { readonly, fileMustExist: readonly })
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  if (!readonly) {
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = FULL')
    applyMigrations(database, targetVersion)
  }
  return database
}

export function verifySqliteDatabase(database) {
  const integrity = database.pragma('integrity_check', { simple: true })
  const foreignKeys = database.pragma('foreign_key_check')
  const requiredTables = ['app_users', 'auth_sessions', 'password_reset_tokens', 'initialized_credit_users', 'credit_lot_groups', 'credit_reservations', 'credit_reservation_operations', 'credit_operations', 'payment_orders', 'payment_events', 'generation_tasks', 'works', 'provider_configs', 'provider_audit', 'redemption_codes', 'redemption_code_uses', 'user_feedback', 'admin_style_references', 'stored_objects']
  const present = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name))
  const missingTables = requiredTables.filter((name) => !present.has(name))
  const ledgerIssues = []
  const redemptionIssues = []
  if (present.has('credit_lot_groups') && present.has('credit_reservations') && present.has('credit_operations')) {
    const groups = database.prepare('SELECT user_id, value_json FROM credit_lot_groups').all()
    const lots = new Map()
    for (const group of groups) {
      for (const lot of JSON.parse(group.value_json)) {
        lots.set(lot.id, lot)
        if (lot.userId !== group.user_id || lot.amount < 0 || lot.consumed < 0 || lot.reserved < 0 || lot.consumed + lot.reserved > lot.amount) ledgerIssues.push(`invalid-lot:${lot.id}`)
      }
    }
    const expectedReserved = new Map()
    const expectedConsumed = new Map()
    const grantsByLot = new Map()
    const entriesByReservation = new Map()
    for (const row of database.prepare('SELECT operation_id, idempotency_key, user_id, operation_type, amount, occurred_at, value_json FROM credit_operations ORDER BY occurred_at, operation_id').all()) {
      const entry = JSON.parse(row.value_json)
      if (entry.id !== row.operation_id || entry.idempotencyKey !== row.idempotency_key || entry.userId !== row.user_id || entry.type !== row.operation_type || entry.amount !== row.amount || entry.occurredAt !== row.occurred_at) ledgerIssues.push(`operation-column-mismatch:${row.operation_id}`)
      if (entry.type === 'grant') grantsByLot.set(entry.lotId, (grantsByLot.get(entry.lotId) ?? 0) + entry.amount)
      if (entry.reservationId) {
        const entries = entriesByReservation.get(entry.reservationId) ?? []
        entries.push(entry)
        entriesByReservation.set(entry.reservationId, entries)
      }
      if (entry.type === 'settle') for (const allocation of entry.allocations ?? []) expectedConsumed.set(allocation.lotId, (expectedConsumed.get(allocation.lotId) ?? 0) + allocation.quantity)
      if (entry.type !== 'grant' && (entry.allocations ?? []).reduce((total, allocation) => total + allocation.quantity, 0) !== entry.amount) ledgerIssues.push(`operation-allocation-mismatch:${entry.id}`)
    }
    for (const row of database.prepare('SELECT value_json FROM credit_reservations').all()) {
      const reservation = JSON.parse(row.value_json)
      const entries = entriesByReservation.get(reservation.id) ?? []
      const reserves = entries.filter((entry) => entry.type === 'reserve')
      const terminals = entries.filter((entry) => entry.type === 'settle' || entry.type === 'release')
      if (reserves.length !== 1 || reserves[0]?.amount !== reservation.amount) ledgerIssues.push(`reservation-operation-mismatch:${reservation.id}`)
      if (reservation.status === 'reserved' && terminals.length !== 0) ledgerIssues.push(`unexpected-terminal-operation:${reservation.id}`)
      const expectedTerminal = { settled: 'settle', released: 'release' }[reservation.status]
      if (reservation.status !== 'reserved' && (terminals.length !== 1 || terminals[0]?.type !== expectedTerminal)) ledgerIssues.push(`terminal-operation-mismatch:${reservation.id}`)
      if (reservation.status !== 'reserved') continue
      for (const allocation of reservation.allocations) expectedReserved.set(allocation.lotId, (expectedReserved.get(allocation.lotId) ?? 0) + allocation.quantity)
    }
    for (const [lotId, lot] of lots) {
      if ((grantsByLot.get(lotId) ?? 0) !== lot.amount) ledgerIssues.push(`grant-mismatch:${lotId}`)
      if ((expectedReserved.get(lotId) ?? 0) !== lot.reserved) ledgerIssues.push(`reservation-mismatch:${lotId}`)
      if ((expectedConsumed.get(lotId) ?? 0) !== lot.consumed) ledgerIssues.push(`consumption-mismatch:${lotId}`)
    }
    for (const lotId of expectedReserved.keys()) if (!lots.has(lotId)) ledgerIssues.push(`missing-lot:${lotId}`)
    for (const lotId of expectedConsumed.keys()) if (!lots.has(lotId)) ledgerIssues.push(`missing-consumed-lot:${lotId}`)
    for (const lotId of grantsByLot.keys()) if (!lots.has(lotId)) ledgerIssues.push(`missing-granted-lot:${lotId}`)
  }
  if (present.has('redemption_codes') && present.has('redemption_code_uses')) {
    const usesByCode = new Map()
    for (const row of database.prepare('SELECT redemption_key, code_id, user_id, value_json FROM redemption_code_uses').all()) {
      const redemption = JSON.parse(row.value_json)
      if (redemption.id !== row.redemption_key || redemption.codeId !== row.code_id || redemption.userId !== row.user_id) redemptionIssues.push(`redemption-column-mismatch:${row.redemption_key}`)
      usesByCode.set(row.code_id, (usesByCode.get(row.code_id) ?? 0) + 1)
    }
    for (const row of database.prepare('SELECT code_id, value_json FROM redemption_codes').all()) {
      const code = JSON.parse(row.value_json)
      const useCount = usesByCode.get(row.code_id) ?? 0
      if (code.id !== row.code_id || code.redeemedCount !== useCount || code.redeemedCount > code.maxRedemptions) redemptionIssues.push(`redemption-count-mismatch:${row.code_id}`)
      usesByCode.delete(row.code_id)
    }
    for (const codeId of usesByCode.keys()) redemptionIssues.push(`missing-redemption-code:${codeId}`)
  }
  return {
    ok: integrity === 'ok' && foreignKeys.length === 0 && missingTables.length === 0 && ledgerIssues.length === 0 && redemptionIssues.length === 0,
    integrity,
    foreignKeyViolations: foreignKeys.length,
    missingTables,
    ledgerIssues,
    redemptionIssues,
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

export const sqliteSchemaVersion = LATEST_SCHEMA_VERSION
