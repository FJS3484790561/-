import { randomUUID } from 'node:crypto'

const MAX_MESSAGE_LENGTH = 2000
const DEFAULT_REWARD_CREDITS = 10

export class MemoryFeedbackStore {
  constructor() { this.feedback = new Map() }
  transaction(work) { return work() }
}

export class FeedbackService {
  constructor({ authService, redemptionCodeService, mailer = {}, store = new MemoryFeedbackStore(), isAdmin = () => false, clock = () => Date.now(), logger = console } = {}) {
    if (!authService || !redemptionCodeService) throw new Error('authService and redemptionCodeService are required')
    this.authService = authService; this.redemptionCodeService = redemptionCodeService; this.mailer = mailer; this.store = store; this.isAdmin = isAdmin; this.clock = clock; this.logger = logger
  }

  create({ sessionToken, message }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    const text = typeof message === 'string' ? message.trim() : ''
    if (!text || text.length > MAX_MESSAGE_LENGTH) return { ok: false, code: 'VALIDATION_ERROR' }
    const record = { id: `feedback_${randomUUID()}`, userId: user.id, email: user.email, message: text, status: 'pending', createdAt: this.clock(), updatedAt: this.clock() }
    this.store.transaction(() => this.store.feedback.set(record.id, record))
    return { ok: true, feedback: this.#public(record) }
  }

  list({ sessionToken }) {
    const admin = this.#admin(sessionToken)
    if (!admin.ok) return admin
    return { ok: true, feedback: [...this.store.feedback.values()].sort((left, right) => right.createdAt - left.createdAt).map((record) => this.#public(record)) }
  }

  async decide({ sessionToken, feedbackId, decision, credits = DEFAULT_REWARD_CREDITS }) {
    const admin = this.#admin(sessionToken)
    if (!admin.ok) return admin
    const record = this.store.feedback.get(feedbackId)
    if (!record) return { ok: false, code: 'NOT_FOUND' }
    if (decision === 'reject') {
      if (record.status === 'accepted') return { ok: false, code: 'FEEDBACK_ALREADY_ACCEPTED' }
      record.status = 'rejected'; record.updatedAt = this.clock(); this.store.feedback.set(record.id, record)
      return { ok: true, feedback: this.#public(record) }
    }
    if (decision !== 'accept' || !Number.isSafeInteger(credits) || credits < 1 || credits > 100_000) return { ok: false, code: 'VALIDATION_ERROR' }
    if (record.status === 'accepted') return { ok: true, feedback: this.#public(record) }
    let reward
    if (record.rewardCodeId) reward = this.redemptionCodeService.getForDelivery({ codeId: record.rewardCodeId })
    else {
      reward = this.redemptionCodeService.createReward({ credits, email: record.email, source: record.id })
      if (reward.ok) { record.rewardCodeId = reward.redemptionCode.id; record.rewardCredits = credits; this.store.feedback.set(record.id, record) }
    }
    if (!reward?.ok) return reward ?? { ok: false, code: 'REDEMPTION_CODE_UNAVAILABLE' }
    if (typeof this.mailer.sendFeedbackReward !== 'function') return { ok: false, code: 'MAIL_UNAVAILABLE' }
    try {
      await this.mailer.sendFeedbackReward({ email: record.email, code: reward.code, credits: reward.credits })
    } catch {
      record.mailStatus = 'failed'; record.updatedAt = this.clock(); this.store.feedback.set(record.id, record)
      this.logger.error?.('[Feedback]', { feedbackId: record.id, stage: 'reward-mail', code: 'MAIL_DELIVERY_FAILED' })
      return { ok: false, code: 'MAIL_UNAVAILABLE' }
    }
    record.status = 'accepted'; record.mailStatus = 'sent'; record.acceptedAt = this.clock(); record.updatedAt = this.clock(); this.store.feedback.set(record.id, record)
    return { ok: true, feedback: this.#public(record) }
  }

  remove({ sessionToken, feedbackId }) {
    const admin = this.#admin(sessionToken)
    if (!admin.ok) return admin
    const record = this.store.feedback.get(feedbackId)
    if (!record) return { ok: false, code: 'NOT_FOUND' }
    if (record.status !== 'rejected') return { ok: false, code: 'FEEDBACK_NOT_REJECTED' }
    this.store.transaction(() => this.store.feedback.delete(feedbackId))
    return { ok: true, deleted: true }
  }

  #admin(sessionToken) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    return this.isAdmin(user) ? { ok: true, user } : { ok: false, code: 'FORBIDDEN' }
  }

  #public(record) {
    return { id: record.id, email: record.email, message: record.message, status: record.status, rewardCredits: record.rewardCredits ?? null, mailStatus: record.mailStatus ?? null, createdAt: record.createdAt, updatedAt: record.updatedAt, ...(record.acceptedAt ? { acceptedAt: record.acceptedAt } : {}) }
  }
}

export const feedbackConstants = { DEFAULT_REWARD_CREDITS, MAX_MESSAGE_LENGTH }
