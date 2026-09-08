const DAY_MS = 24 * 60 * 60 * 1000
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

function numbers(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]))
}

export class AdminOverviewService {
  constructor({ database = null, authService, isAdmin = () => false, clock = () => Date.now() } = {}) {
    this.database = database
    this.authService = authService
    this.isAdmin = isAdmin
    this.clock = clock
  }

  get({ sessionToken } = {}) {
    const user = this.authService?.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    if (!this.isAdmin(user)) return { ok: false, code: 'FORBIDDEN' }
    // Missing persistence is not evidence that the application has zero users/data.
    if (!this.database) return { ok: false, code: 'OVERVIEW_UNAVAILABLE' }
    const now = this.clock()
    const today = Math.floor((now + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS
    const last7Days = today - 6 * DAY_MS
    // A deferred read transaction keeps all cards on the same SQLite snapshot.
    return this.database.transaction(() => {
      const one = (sql, ...params) => numbers(this.database.prepare(sql).get(...params))
      // Table names are internal constants; historical image payloads never leave SQLite.
      const activity = (table) => one(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN json_extract(value_json, '$.createdAt') BETWEEN ? AND ? THEN 1 ELSE 0 END) AS today,
          SUM(CASE WHEN json_extract(value_json, '$.createdAt') BETWEEN ? AND ? THEN 1 ELSE 0 END) AS last7Days
        FROM ${table}`, today, now, last7Days, now)
      const users = activity('app_users')
      const works = activity('works')
      const generations = {
        ...activity('generation_tasks'),
        ...one(`SELECT
          SUM(json_extract(value_json, '$.status') = 'succeeded') AS succeeded,
          SUM(json_extract(value_json, '$.status') = 'failed') AS failed,
          SUM(json_extract(value_json, '$.status') IN ('queued', 'running')) AS running
          FROM generation_tasks`),
      }
      const finished = generations.succeeded + generations.failed
      generations.successRate = finished ? Math.round(generations.succeeded / finished * 1000) / 10 : null
      const providers = one(`SELECT COUNT(*) AS total,
        SUM(json_extract(value_json, '$.enabled') = 1) AS enabled FROM provider_configs`)
      providers.disabled = providers.total - providers.enabled
      const redemptionCodes = one(`SELECT COUNT(*) AS total,
        SUM(json_extract(value_json, '$.redeemedCount')) AS redemptions,
        SUM(MAX(0, json_extract(value_json, '$.maxRedemptions') - json_extract(value_json, '$.redeemedCount'))) AS remaining
        FROM redemption_codes`)
      const storage = one('SELECT COUNT(*) AS objects, SUM(size_bytes) AS bytes FROM stored_objects')
      const credits = one(`SELECT
        SUM(CASE WHEN json_extract(lot.value, '$.expiresAt') > ?
          THEN MAX(0, json_extract(lot.value, '$.amount') - json_extract(lot.value, '$.consumed') - json_extract(lot.value, '$.reserved'))
          ELSE 0 END) AS available,
        SUM(json_extract(lot.value, '$.reserved')) AS reserved,
        SUM(json_extract(lot.value, '$.consumed')) AS consumed
        FROM credit_lot_groups, json_each(credit_lot_groups.value_json) AS lot`, now)
      credits.granted = one("SELECT SUM(amount) AS total FROM credit_operations WHERE operation_type = 'grant'").total
      return { ok: true, overview: {
        users, generations, works, credits, redemptionCodes, providers, storage,
        generatedAt: now, timeZone: 'Asia/Shanghai',
      } }
    }).deferred()
  }
}
