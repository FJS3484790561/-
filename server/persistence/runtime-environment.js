import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { createAppRuntime } from '../app-runtime.js'
import { createObjectStorageFromEnvironment } from './object-storage.js'
import { createSqliteStores } from './sqlite-stores.js'

function encryptionKey(environment, production) {
  if (!environment.APP_ENCRYPTION_KEY) {
    if (production) throw new Error('APP_ENCRYPTION_KEY is required in production')
    return randomBytes(32)
  }
  const key = Buffer.from(environment.APP_ENCRYPTION_KEY, 'base64')
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  return key
}

export function createRuntimeFromEnvironment({ environment = process.env, mailer, paymentProvider, generationProvider } = {}) {
  const production = environment.NODE_ENV === 'production'
  const filename = environment.APP_DATABASE_PATH
  if (!filename) {
    if (production) throw new Error('APP_DATABASE_PATH is required in production')
    return createAppRuntime({
      mailer,
      paymentProvider,
      generationProvider,
      encryptionKey: encryptionKey(environment, false),
      secureCookies: false,
      adminEmail: environment.ADMIN_EMAIL ?? 'admin@example.com',
    })
  }

  const persistence = createSqliteStores({ filename })
  try {
    const storageEnvironment = { ...environment }
    if (!production && !storageEnvironment.LOCAL_OBJECT_STORAGE_PATH) storageEnvironment.LOCAL_OBJECT_STORAGE_PATH = join(dirname(filename), 'objects')
    const objectStorage = createObjectStorageFromEnvironment({ environment: storageEnvironment, production, metadata: persistence.objects })
    return createAppRuntime({
      mailer,
      paymentProvider,
      generationProvider,
      encryptionKey: encryptionKey(environment, production),
      secureCookies: production,
      adminEmail: environment.ADMIN_EMAIL ?? 'admin@example.com',
      stores: persistence,
      objectStorage,
      close: persistence.close,
    })
  } catch (error) {
    persistence.close()
    throw error
  }
}
