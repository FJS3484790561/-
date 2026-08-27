import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthService } from './auth-service.js'
import { CreditLedgerService } from './credit-ledger.js'
import { RedemptionCodeService } from './redemption-code-service.js'

async function fixture() {
  const authService = new AuthService({ reservedRegistrationEmails: ['admin@example.com'] })
  const admin = await authService.provisionUser({ email: 'admin@example.com', password: 'correct-horse' })
  const user = await authService.register({ email: 'user@example.com', password: 'correct-horse' })
  const other = await authService.register({ email: 'other@example.com', password: 'correct-horse' })
  const adminLogin = await authService.login({ email: 'admin@example.com', password: 'correct-horse' })
  const userLogin = await authService.login({ email: 'user@example.com', password: 'correct-horse' })
  const otherLogin = await authService.login({ email: 'other@example.com', password: 'correct-horse' })
  const creditLedger = new CreditLedgerService({ authService })
  const service = new RedemptionCodeService({ authService, creditLedger, isAdmin: (account) => account.id === admin.user.id, codeGenerator: () => 'ROOM-2345-6789-ABCD' })
  return { service, creditLedger, adminToken: adminLogin.sessionToken, userToken: userLogin.sessionToken, otherToken: otherLogin.sessionToken, userId: user.user.id, otherId: other.user.id }
}

test('only administrators can create and list codes and the full code is returned once', async () => {
  const data = await fixture()
  assert.equal(data.service.create({ sessionToken: data.userToken, credits: 5, maxRedemptions: 2 }).code, 'FORBIDDEN')
  const created = data.service.create({ sessionToken: data.adminToken, credits: 5, maxRedemptions: 2 })
  assert.equal(created.code, 'ROOM-2345-6789-ABCD')
  assert.equal(created.redemptionCode.preview, 'ROOM-••••-••••-ABCD')
  const listed = data.service.list({ sessionToken: data.adminToken })
  assert.equal(JSON.stringify(listed).includes('ROOM-2345-6789-ABCD'), false)
})

test('redeems once per user, grants configured credits and enforces the total limit', async () => {
  const data = await fixture()
  data.service.create({ sessionToken: data.adminToken, credits: 7, maxRedemptions: 1 })
  const redeemed = data.service.redeem({ sessionToken: data.userToken, code: ' room-2345-6789-abcd ' })
  assert.equal(redeemed.creditsAdded, 7)
  assert.equal(redeemed.available, 10)
  assert.equal(data.service.redeem({ sessionToken: data.userToken, code: 'ROOM-2345-6789-ABCD' }).code, 'REDEMPTION_CODE_ALREADY_USED')
  assert.equal(data.service.redeem({ sessionToken: data.otherToken, code: 'ROOM-2345-6789-ABCD' }).code, 'REDEMPTION_CODE_EXHAUSTED')
  assert.equal(data.creditLedger.getBalanceForUser({ userId: data.otherId }).available, 3)
})

test('rejects invalid limits and invalid codes without granting credits', async () => {
  const data = await fixture()
  assert.equal(data.service.create({ sessionToken: data.adminToken, credits: 0, maxRedemptions: 1 }).code, 'VALIDATION_ERROR')
  assert.equal(data.service.create({ sessionToken: data.adminToken, credits: 1, maxRedemptions: 0 }).code, 'VALIDATION_ERROR')
  assert.equal(data.service.redeem({ sessionToken: data.userToken, code: 'wrong' }).code, 'INVALID_REDEMPTION_CODE')
  assert.equal(data.creditLedger.getBalanceForUser({ userId: data.userId }).available, 3)
})
