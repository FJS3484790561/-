import { openSqliteDatabase } from './sqlite-database.js'

const encode = (value) => JSON.stringify(value)
const decode = (value) => JSON.parse(value)

class SqliteJsonMap {
  constructor(database, { table, keyColumn, extras = {} }) {
    this.database = database
    this.table = table
    this.keyColumn = keyColumn
    this.extras = extras
    const extraColumns = Object.keys(extras)
    const columns = [keyColumn, ...extraColumns, 'value_json']
    const placeholders = columns.map(() => '?').join(', ')
    const updates = [...extraColumns, 'value_json'].map((column) => `${column} = excluded.${column}`).join(', ')
    this.selectOne = database.prepare(`SELECT value_json FROM ${table} WHERE ${keyColumn} = ?`)
    this.selectAll = database.prepare(`SELECT ${keyColumn} AS entry_key, value_json FROM ${table}`)
    this.deleteOne = database.prepare(`DELETE FROM ${table} WHERE ${keyColumn} = ?`)
    this.upsert = database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${keyColumn}) DO UPDATE SET ${updates}`)
  }

  has(key) {
    return Boolean(this.selectOne.get(String(key)))
  }

  get(key) {
    const row = this.selectOne.get(String(key))
    return row ? decode(row.value_json) : undefined
  }

  set(key, value) {
    const extraValues = Object.values(this.extras).map((extract) => extract(value, key))
    this.upsert.run(String(key), ...extraValues, encode(value))
    return this
  }

  delete(key) {
    return this.deleteOne.run(String(key)).changes > 0
  }

  values() {
    return this.selectAll.all().map((row) => decode(row.value_json)).values()
  }

  entries() {
    return this.selectAll.all().map((row) => [row.entry_key, decode(row.value_json)]).values()
  }

  [Symbol.iterator]() {
    return this.entries()
  }
}

class SqliteIdSet {
  constructor(database, table, column) {
    this.hasStatement = database.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`)
    this.addStatement = database.prepare(`INSERT OR IGNORE INTO ${table} (${column}) VALUES (?)`)
  }

  has(value) {
    return Boolean(this.hasStatement.get(String(value)))
  }

  add(value) {
    this.addStatement.run(String(value))
    return this
  }
}

class SqliteAuditCollection {
  constructor(database) {
    this.insert = database.prepare('INSERT INTO provider_audit (audit_id, provider_id, value_json) VALUES (?, ?, ?)')
    this.selectAll = database.prepare('SELECT value_json FROM provider_audit ORDER BY rowid')
  }

  push(...entries) {
    for (const entry of entries) this.insert.run(entry.id, entry.providerId, encode(entry))
    return this.selectAll.all().length
  }

  filter(predicate) {
    return this.selectAll.all().map((row) => decode(row.value_json)).filter(predicate)
  }

  [Symbol.iterator]() {
    return this.selectAll.all().map((row) => decode(row.value_json)).values()
  }
}

class SqliteCreditJournal {
  constructor(database) {
    this.insert = database.prepare(`
      INSERT INTO credit_operations
        (operation_id, idempotency_key, user_id, operation_type, amount, occurred_at, value_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    this.selectByKey = database.prepare('SELECT value_json FROM credit_operations WHERE idempotency_key = ?')
    this.selectAll = database.prepare('SELECT value_json FROM credit_operations ORDER BY occurred_at, operation_id')
  }

  get(idempotencyKey) {
    const row = this.selectByKey.get(String(idempotencyKey))
    return row ? decode(row.value_json) : undefined
  }

  append(entry) {
    this.insert.run(entry.id, entry.idempotencyKey, entry.userId, entry.type, entry.amount, entry.occurredAt, encode(entry))
    return entry
  }

  values() {
    return this.selectAll.all().map((row) => decode(row.value_json)).values()
  }
}

function transaction(database) {
  return (work) => database.transaction(work).immediate()
}

export function createSqliteStores({ filename } = {}) {
  const database = openSqliteDatabase({ filename })
  const runTransaction = transaction(database)
  const auth = {
    users: new SqliteJsonMap(database, { table: 'app_users', keyColumn: 'email', extras: { entity_id: (value) => value.id } }),
    sessions: new SqliteJsonMap(database, { table: 'auth_sessions', keyColumn: 'token_digest', extras: { user_id: (value) => value.userId } }),
    resetTokens: new SqliteJsonMap(database, { table: 'password_reset_tokens', keyColumn: 'token_digest', extras: { user_id: (value) => value.userId } }),
    transaction: runTransaction,
  }
  const credits = {
    lots: new SqliteJsonMap(database, { table: 'credit_lot_groups', keyColumn: 'user_id' }),
    reservations: new SqliteJsonMap(database, { table: 'credit_reservations', keyColumn: 'reservation_id', extras: { user_id: (value) => value.userId } }),
    operations: new SqliteJsonMap(database, { table: 'credit_reservation_operations', keyColumn: 'operation_key', extras: { reservation_id: (value) => value.id } }),
    journal: new SqliteCreditJournal(database),
    initializedUsers: new SqliteIdSet(database, 'initialized_credit_users', 'user_id'),
    transaction: runTransaction,
  }
  const payments = {
    orders: new SqliteJsonMap(database, { table: 'payment_orders', keyColumn: 'order_id', extras: { user_id: (value) => value.userId } }),
    events: new SqliteJsonMap(database, { table: 'payment_events', keyColumn: 'event_id' }),
    transaction: runTransaction,
  }
  const generations = {
    tasks: new SqliteJsonMap(database, { table: 'generation_tasks', keyColumn: 'task_id', extras: { user_id: (value) => value.userId } }),
    transaction: runTransaction,
  }
  const works = {
    works: new SqliteJsonMap(database, { table: 'works', keyColumn: 'work_id', extras: { user_id: (value) => value.userId } }),
    transaction: runTransaction,
  }
  const providers = {
    configs: new SqliteJsonMap(database, { table: 'provider_configs', keyColumn: 'provider_id', extras: { provider_name: (value) => value.name } }),
    audit: new SqliteAuditCollection(database),
    transaction: runTransaction,
  }
  const objects = new SqliteJsonMap(database, { table: 'stored_objects', keyColumn: 'object_key', extras: {
    owner_id: (value) => value.ownerId ?? null,
    mime_type: (value) => value.mimeType,
    size_bytes: (value) => value.sizeBytes,
    created_at: (value) => value.createdAt,
    metadata_json: (value) => encode(value.metadata ?? {}),
  } })
  return { database, auth, credits, payments, generations, works, providers, objects, close: () => database.close() }
}
