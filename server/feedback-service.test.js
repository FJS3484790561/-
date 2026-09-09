import assert from 'node:assert/strict'
import test from 'node:test'
import { createAppRuntime } from './app-runtime.js'

async function login(authService, email) {
  return (await authService.login({ email, password: 'correct-horse' })).sessionToken
}

test('feedback reward retries delivery without creating a second code', async () => {
  const messages = []
  let failMail = true
  const runtime = createAppRuntime({ mailer: { sendFeedbackReward: async (message) => { if (failMail) throw new Error('smtp unavailable'); messages.push(message) } } })
  const admin = await runtime.provisionAdmin({ password: 'correct-horse' })
  await runtime.authService.provisionUser({ email: 'feedback@example.com', password: 'correct-horse' })
  const adminToken = await login(runtime.authService, admin.user.email)
  const userToken = await login(runtime.authService, 'feedback@example.com')
  const submitted = runtime.feedbackService.create({ sessionToken: userToken, message: '请增加更多风格。' })
  const first = await runtime.feedbackService.decide({ sessionToken: adminToken, feedbackId: submitted.feedback.id, decision: 'accept', credits: 10 })
  assert.equal(first.code, 'MAIL_UNAVAILABLE')
  const pending = runtime.feedbackService.store.feedback.get(submitted.feedback.id)
  assert.equal(pending.status, 'pending')
  const firstCodeId = pending.rewardCodeId
  failMail = false
  const second = await runtime.feedbackService.decide({ sessionToken: adminToken, feedbackId: submitted.feedback.id, decision: 'accept', credits: 99 })
  assert.equal(second.feedback.status, 'accepted')
  assert.equal(second.feedback.rewardCredits, 10)
  assert.equal(messages.length, 1)
  assert.equal(runtime.feedbackService.store.feedback.get(submitted.feedback.id).rewardCodeId, firstCodeId)
  assert.equal(runtime.redemptionCodeService.store.codes.size, 1)
  assert.equal(messages[0].credits, 10)
  assert.equal(messages[0].email, 'feedback@example.com')
})

test('feedback and reward code are isolated by user email', async () => {
  const runtime = createAppRuntime({ mailer: { sendFeedbackReward: async () => {} } })
  const admin = await runtime.provisionAdmin({ password: 'correct-horse' })
  await runtime.authService.provisionUser({ email: 'feedback-one@example.com', password: 'correct-horse' })
  await runtime.authService.provisionUser({ email: 'feedback-two@example.com', password: 'correct-horse' })
  const adminToken = await login(runtime.authService, admin.user.email)
  const oneToken = await login(runtime.authService, 'feedback-one@example.com')
  const twoToken = await login(runtime.authService, 'feedback-two@example.com')
  const submitted = runtime.feedbackService.create({ sessionToken: oneToken, message: '第一条反馈' })
  assert.equal(runtime.feedbackService.create({ sessionToken: 'invalid', message: '不应保存' }).code, 'UNAUTHORIZED')
  const accepted = await runtime.feedbackService.decide({ sessionToken: adminToken, feedbackId: submitted.feedback.id, decision: 'accept', credits: 10 })
  const reward = runtime.redemptionCodeService.getForDelivery({ codeId: runtime.feedbackService.store.feedback.get(submitted.feedback.id).rewardCodeId })
  assert.equal(reward.email, 'feedback-one@example.com')
  assert.equal(runtime.redemptionCodeService.redeem({ sessionToken: twoToken, code: reward.code }).code, 'REDEMPTION_CODE_EMAIL_MISMATCH')
  assert.equal(runtime.redemptionCodeService.redeem({ sessionToken: oneToken, code: reward.code }).creditsAdded, 10)
  assert.equal(accepted.feedback.status, 'accepted')
})

test('rejected feedback can be deleted but accepted feedback cannot', async () => {
  const runtime = createAppRuntime()
  const admin = await runtime.provisionAdmin({ password: 'correct-horse' })
  await runtime.authService.provisionUser({ email: 'feedback@example.com', password: 'correct-horse' })
  const adminToken = await login(runtime.authService, admin.user.email)
  const userToken = await login(runtime.authService, 'feedback@example.com')
  const rejected = runtime.feedbackService.create({ sessionToken: userToken, message: '暂不需要这个功能' })
  assert.equal(runtime.feedbackService.remove({ sessionToken: adminToken, feedbackId: rejected.feedback.id }).code, 'FEEDBACK_NOT_REJECTED')
  runtime.feedbackService.decide({ sessionToken: adminToken, feedbackId: rejected.feedback.id, decision: 'reject' })
  assert.equal(runtime.feedbackService.remove({ sessionToken: adminToken, feedbackId: rejected.feedback.id }).deleted, true)
})
