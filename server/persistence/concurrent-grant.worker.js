import { parentPort, workerData } from 'node:worker_threads'
import { createAppRuntime } from '../app-runtime.js'
import { createSqliteStores } from './sqlite-stores.js'

const encryptionKey = Buffer.alloc(32, 7)
const control = new Int32Array(workerData.control)
const stores = createSqliteStores({ filename: workerData.filename })
const runtime = createAppRuntime({ stores, encryptionKey, close: stores.close })

function grant() {
  return runtime.creditLedger.grantForUser({
    userId: workerData.userId,
    amount: 12,
    source: 'payment:shared',
    idempotencyKey: 'payment:shared',
  })
}

try {
  if (workerData.role === 'holder') {
    stores.database.exec('BEGIN IMMEDIATE')
    parentPort.postMessage({ type: 'lock-held' })
    Atomics.wait(control, 0, 0)
    stores.database.exec('COMMIT')
  } else {
    parentPort.postMessage({ type: 'ready' })
    Atomics.wait(control, 1, 0)
    parentPort.postMessage({ type: 'grant-started' })
  }
  const startedAt = Date.now()
  const result = grant()
  parentPort.postMessage({ type: 'result', role: workerData.role, elapsedMs: Date.now() - startedAt, result })
} catch (error) {
  try {
    if (stores.database.inTransaction) stores.database.exec('ROLLBACK')
  } catch {
    // Preserve the original worker error.
  }
  parentPort.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
} finally {
  runtime.close()
}
