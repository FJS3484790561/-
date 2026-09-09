import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthService } from './auth-service.js'
import { CreditLedgerService } from './credit-ledger.js'
import { RedemptionCodeService } from './redemption-code-service.js'
import { randomBytes } from 'node:crypto'

async function fixture() {
  const authService = new AuthService({ reservedRegistrationEmails: ['admin@example.com'] })
  const admin = await authService.provisionUser({ email: 'admin@example.com', password: 'correct-horse' })
  const user = await authService.provisionUser({ email: 'user@example.com', password: 'correct-horse' })
  const other = await authService.provisionUser({ email: 'other@example.com', password: 'correct-horse' })
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

test('stores an encrypted full code for repeat administrator viewing and safely removes it', async () => {
  const data = await fixture()
  const encrypted = new RedemptionCodeService({ authService: data.service.authService, creditLedger: data.creditLedger, isAdmin: (account) => account.id === data.service.authService.getSession(data.adminToken).id, encryptionKey: randomBytes(32), codeGenerator: () => 'ROOM-3456-789A-BCDE' })
  const created = encrypted.create({ sessionToken: data.adminToken, credits: 4, maxRedemptions: 2 })
  assert.equal(encrypted.list({ sessionToken: data.adminToken }).redemptionCodes[0].code, created.code)
  assert.equal(encrypted.remove({ sessionToken: data.adminToken, codeId: created.redemptionCode.id }).deleted, true)
  assert.equal(encrypted.list({ sessionToken: data.adminToken }).redemptionCodes.length, 0)
})

test('soft deletes redeemed codes so quota history remains visible', async () => {
  const data = await fixture()
  const encrypted = new RedemptionCodeService({ authService: data.service.authService, creditLedger: data.creditLedger, isAdmin: (account) => account.id === data.service.authService.getSession(data.adminToken).id, encryptionKey: randomBytes(32), codeGenerator: () => 'ROOM-3456-789A-BCDE' })
  const created = encrypted.create({ sessionToken: data.adminToken, credits: 4, maxRedemptions: 1 })
  assert.equal(encrypted.redeem({ sessionToken: data.userToken, code: created.code }).creditsAdded, 4)
  const removed = encrypted.remove({ sessionToken: data.adminToken, codeId: created.redemptionCode.id })
  assert.equal(removed.redemptionCode.deletedAt > 0, true)
  assert.equal(encrypted.list({ sessionToken: data.adminToken }).redemptionCodes[0].code, created.code)
  assert.equal(encrypted.redeem({ sessionToken: data.otherToken, code: created.code }).code, 'INVALID_REDEMPTION_CODE')
})
