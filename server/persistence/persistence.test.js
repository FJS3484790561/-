import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAppRuntime } from '../app-runtime.js'
import { backupSqliteDatabase, openSqliteDatabase, verifySqliteDatabase } from './sqlite-database.js'
import { LocalObjectStorage, TencentCosObjectStorage } from './object-storage.js'
import { createRuntimeFromEnvironment } from './runtime-environment.js'
import { createSqliteStores } from './sqlite-stores.js'

const encryptionKey = Buffer.alloc(32, 7)

function paymentProvider() {
  return {
    createPayment: ({ orderId }) => ({ providerPaymentId: `pay_${orderId}`, checkoutUrl: 'https://pay.example.test' }),
    verifyCallback: ({ signature }) => signature === 'valid',
  }
}

function runtimeFor(stores, objectRoot = null) {
  const objectStorage = objectRoot ? new LocalObjectStorage({ root: objectRoot, metadata: stores.objects }) : null
  return createAppRuntime({ stores, objectStorage, encryptionKey, paymentProvider: paymentProvider(), adminEmail: 'admin@example.com', close: stores.close })
}

async function registerAndLogin(runtime, email, password = 'password123') {
  assert.equal((await runtime.authService.register({ email, password })).ok, true)
  const login = await runtime.authService.login({ email, password })
  assert.equal(login.ok, true)
  return login
}

test('persists accounts, sessions, credits, orders, generations, works and provider configuration across a real reopen', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'interior-persistence-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const filename = join(root, 'app.sqlite')

  let stores = createSqliteStores({ filename })
  let runtime = runtimeFor(stores, join(root, 'objects'))
  const userLogin = await registerAndLogin(runtime, 'user@example.com')
  assert.equal(runtime.creditLedger.getBalance({ sessionToken: userLogin.sessionToken }).available, 3)
  const order = runtime.paymentService.createOrder({ sessionToken: userLogin.sessionToken, amountYuan: 10 })
  assert.equal(order.ok, true)
  assert.equal(runtime.paymentService.handleCallback({
    eventId: 'event_1',
    orderId: order.order.id,
    providerPaymentId: order.order.providerPaymentId,
    status: 'paid',
    amountFen: 1000,
    currency: 'CNY',
    userId: userLogin.user.id,
    signature: 'valid',
  }).ok, true)

  const generation = await runtime.generationService.createGeneration({
    sessionToken: userLogin.sessionToken,
    image: { name: 'room.jpg', type: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0x00]) },
    params: { room: '客厅', theme: '现代简约', scale: '均衡', preferences: { light: true } },
  })
  const completed = await runtime.generationService.waitForGeneration(generation.task.id)
  assert.equal(completed.status, 'succeeded')
  assert.match(completed.result.original.url, /^\/api\/objects\//u)
  assert.match(completed.result.effectImage.url, /^\/api\/objects\//u)
  assert.equal(stores.database.prepare('SELECT COUNT(*) AS count FROM stored_objects').get().count, 2)
  const objectResponse = await runtime.api.handle(new Request(`http://localhost${completed.result.effectImage.url}`, { headers: { cookie: `session=${encodeURIComponent(userLogin.sessionToken)}` } }))
  assert.equal(objectResponse.status, 200)
  assert.equal(objectResponse.headers.get('content-type'), 'image/jpeg')
  const work = runtime.worksService.create({ sessionToken: userLogin.sessionToken, generationId: generation.task.id, original: { url: 'objects/original.jpg', mimeType: 'image/jpeg' }, effectImage: completed.result.effectImage, params: { room: '客厅', preferences: {} } })
  assert.equal(work.ok, true)

  assert.equal((await runtime.provisionAdmin({ password: 'admin-password' })).ok, true)
  const adminLogin = await runtime.authService.login({ email: 'admin@example.com', password: 'admin-password' })
  const provider = runtime.adminProviderService.create({ sessionToken: adminLogin.sessionToken, name: 'primary', endpoint: 'https://provider.example.test', model: 'interior-v1', apiKey: 'test-key' })
  assert.equal(provider.ok, true)
  assert.equal(runtime.adminProviderService.setEnabled({ sessionToken: adminLogin.sessionToken, providerId: provider.provider.id, enabled: true }).ok, true)
  runtime.close()

  stores = createSqliteStores({ filename })
  runtime = runtimeFor(stores, join(root, 'objects'))
  assert.equal(runtime.authService.getSession(userLogin.sessionToken).email, 'user@example.com')
  assert.equal(runtime.creditLedger.getBalance({ sessionToken: userLogin.sessionToken }).available, 14)
  assert.equal(runtime.paymentService.getOrder({ sessionToken: userLogin.sessionToken, orderId: order.order.id }).order.status, 'paid')
  assert.equal(runtime.generationService.getGeneration({ sessionToken: userLogin.sessionToken, taskId: generation.task.id }).task.status, 'succeeded')
  assert.equal(runtime.worksService.get({ sessionToken: userLogin.sessionToken, workId: work.work.id }).work.id, work.work.id)
  assert.equal(runtime.adminProviderService.readSecretForProvider({ providerId: provider.provider.id }).apiKey, 'test-key')
  runtime.close()
})

test('rolls back a multi-store transaction and keeps reservation operations idempotent', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'interior-transaction-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const stores = createSqliteStores({ filename: join(root, 'app.sqlite') })
  const runtime = runtimeFor(stores)
  const login = await registerAndLogin(runtime, 'ledger@example.com')
  assert.equal(runtime.creditLedger.getBalance({ sessionToken: login.sessionToken }).available, 3)

  assert.throws(() => stores.database.transaction(() => {
    runtime.creditLedger.grantForUser({ userId: login.user.id, amount: 20, source: 'rollback-test' })
    throw new Error('rollback')
  })(), /rollback/)
  assert.equal(runtime.creditLedger.getBalance({ sessionToken: login.sessionToken }).available, 3)

  const first = runtime.creditLedger.reserveForUser({ userId: login.user.id, operationId: 'same-operation', amount: 1 })
  const duplicate = runtime.creditLedger.reserveForUser({ userId: login.user.id, operationId: 'same-operation', amount: 1 })
  assert.equal(first.reservation.id, duplicate.reservation.id)
  assert.equal(runtime.creditLedger.getBalance({ sessionToken: login.sessionToken }).available, 2)
  runtime.close()
})

test('rolls back credit settlement when the generation success record cannot be committed', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'interior-generation-rollback-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const stores = createSqliteStores({ filename: join(root, 'app.sqlite') })
  const runtime = runtimeFor(stores)
  const login = await registerAndLogin(runtime, 'generation-rollback@example.com')
  assert.equal(runtime.creditLedger.getBalance({ sessionToken: login.sessionToken }).available, 3)
  const originalSet = stores.generations.tasks.set.bind(stores.generations.tasks)
  let rejectSuccess = true
  stores.generations.tasks.set = (key, value) => {
    if (rejectSuccess && value.status === 'succeeded') {
      rejectSuccess = false
      throw new Error('simulated task write failure')
    }
    return originalSet(key, value)
  }
  const generation = await runtime.generationService.createGeneration({
    sessionToken: login.sessionToken,
    image: { name: 'room.jpg', type: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0x00]) },
    params: { room: '客厅', theme: '现代简约', scale: '均衡', preferences: {} },
  })
  const completed = await runtime.generationService.waitForGeneration(generation.task.id)
  assert.equal(completed.status, 'failed')
  assert.equal(runtime.creditLedger.getBalance({ sessionToken: login.sessionToken }).available, 3)
  assert.equal(verifySqliteDatabase(stores.database).ok, true)
  runtime.close()
})

test('stores object bytes outside SQLite and preserves metadata', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'interior-objects-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const stores = createSqliteStores({ filename: join(root, 'app.sqlite') })
  const runtime = runtimeFor(stores)
  const login = await registerAndLogin(runtime, 'objects@example.com')
  const storage = new LocalObjectStorage({ root: join(root, 'objects'), metadata: stores.objects })
  const record = await storage.put({ key: 'users/example/result.jpg', body: Buffer.from('image-bytes'), mimeType: 'image/jpeg', ownerId: login.user.id, metadata: { kind: 'result' } })
  const loaded = await storage.get({ key: record.key })
  assert.equal(loaded.body.toString(), 'image-bytes')
  assert.equal(loaded.metadata.ownerId, login.user.id)
  assert.equal(await readFile(join(root, 'objects', 'users', 'example', 'result.jpg'), 'utf8'), 'image-bytes')
  assert.equal(stores.database.prepare('SELECT COUNT(*) AS count FROM stored_objects').get().count, 1)
  runtime.close()
})

test('uses the Tencent COS adapter without exposing credentials to callers', async () => {
  const calls = []
  const client = {
    async putObject(input) {
      calls.push({ method: 'put', input })
      return { ETag: 'test' }
    },
    async getObject(input) {
      calls.push({ method: 'get', input })
      return { Body: Buffer.from('cos-image') }
    },
  }
  const storage = new TencentCosObjectStorage({ client, bucket: 'bucket-123', region: 'ap-test' })
  await storage.put({ key: 'results/one.jpg', body: Buffer.from('cos-image'), mimeType: 'image/jpeg' })
  const result = await storage.get({ key: 'results/one.jpg' })
  assert.equal(result.body.toString(), 'cos-image')
  assert.deepEqual(calls.map(({ method, input }) => [method, input.Bucket, input.Region, input.Key]), [
    ['put', 'bucket-123', 'ap-test', 'results/one.jpg'],
    ['get', 'bucket-123', 'ap-test', 'results/one.jpg'],
  ])
})

test('creates a verified backup that can be opened independently', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'interior-backup-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const stores = createSqliteStores({ filename: join(root, 'app.sqlite') })
  const runtime = runtimeFor(stores)
  await registerAndLogin(runtime, 'backup@example.com')
  const destination = join(root, 'restore-check', 'backup.sqlite')
  const result = await backupSqliteDatabase(stores.database, destination)
  assert.equal(result.verification.ok, true)
  runtime.close()

  const restored = openSqliteDatabase({ filename: destination, readonly: true })
  assert.equal(verifySqliteDatabase(restored).ok, true)
  assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM app_users').get().count, 1)
  restored.close()
})

test('rejects incomplete production persistence configuration instead of falling back to memory', async (context) => {
  assert.throws(() => createRuntimeFromEnvironment({ environment: { NODE_ENV: 'production' } }), /APP_DATABASE_PATH/)
  const root = await mkdtemp(join(tmpdir(), 'interior-production-config-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  assert.throws(() => createRuntimeFromEnvironment({ environment: { NODE_ENV: 'production', APP_DATABASE_PATH: join(root, 'app.sqlite') } }), /OBJECT_STORAGE_DRIVER/)

  const runtime = createRuntimeFromEnvironment({ environment: {
    NODE_ENV: 'production',
    APP_DATABASE_PATH: join(root, 'configured.sqlite'),
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    OBJECT_STORAGE_DRIVER: 'cos',
    COS_SECRET_ID: 'configured-at-runtime',
    COS_SECRET_KEY: 'configured-at-runtime',
    COS_BUCKET: 'example-1234567890',
    COS_REGION: 'ap-example',
  } })
  assert.ok(runtime.objectStorage)
  runtime.close()
})
