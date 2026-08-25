import COS from 'cos-nodejs-sdk-v5'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function safeObjectKey(key) {
  const normalized = String(key ?? '').replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid object key')
  return normalized
}

export class LocalObjectStorage {
  constructor({ root, metadata, clock = () => Date.now() } = {}) {
    if (!root) throw new Error('Local object storage root is required')
    this.root = resolve(root)
    this.metadata = metadata
    this.clock = clock
  }

  async put({ key, body, mimeType, ownerId = null, metadata = {} }) {
    const objectKey = safeObjectKey(key)
    const bytes = Buffer.from(body)
    const destination = resolve(this.root, ...objectKey.split('/'))
    if (!destination.startsWith(`${this.root}\\`) && destination !== this.root) throw new Error('Invalid object key')
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, bytes, { flag: 'wx' })
    const record = { key: objectKey, ownerId, mimeType, sizeBytes: bytes.length, createdAt: this.clock(), metadata }
    this.metadata?.set(objectKey, record)
    return record
  }

  async get({ key }) {
    const objectKey = safeObjectKey(key)
    const source = resolve(this.root, ...objectKey.split('/'))
    return { body: await readFile(source), metadata: this.metadata?.get(objectKey) ?? null }
  }

  metadataFor(key) {
    return this.metadata?.get(safeObjectKey(key)) ?? null
  }
}

export class TencentCosObjectStorage {
  constructor({ secretId, secretKey, bucket, region, metadata, clock = () => Date.now(), client } = {}) {
    if (!bucket || !region || (!client && (!secretId || !secretKey))) throw new Error('Tencent COS credentials, bucket and region are required')
    this.client = client ?? new COS({ SecretId: secretId, SecretKey: secretKey })
    this.bucket = bucket
    this.region = region
    this.metadata = metadata
    this.clock = clock
  }

  async put({ key, body, mimeType, ownerId = null, metadata = {} }) {
    const objectKey = safeObjectKey(key)
    const bytes = Buffer.from(body)
    await this.client.putObject({ Bucket: this.bucket, Region: this.region, Key: objectKey, Body: bytes, ContentType: mimeType })
    const record = { key: objectKey, ownerId, mimeType, sizeBytes: bytes.length, createdAt: this.clock(), metadata }
    this.metadata?.set(objectKey, record)
    return record
  }

  async get({ key }) {
    const objectKey = safeObjectKey(key)
    const response = await this.client.getObject({ Bucket: this.bucket, Region: this.region, Key: objectKey })
    return { body: Buffer.from(response.Body), metadata: this.metadata?.get(objectKey) ?? null }
  }

  metadataFor(key) {
    return this.metadata?.get(safeObjectKey(key)) ?? null
  }
}

export function createObjectStorageFromEnvironment({ environment = process.env, production, metadata } = {}) {
  const driver = environment.OBJECT_STORAGE_DRIVER ?? (production ? null : 'local')
  if (driver === 'local' && !production) {
    if (!environment.LOCAL_OBJECT_STORAGE_PATH) throw new Error('LOCAL_OBJECT_STORAGE_PATH is required for local object storage')
    return new LocalObjectStorage({ root: environment.LOCAL_OBJECT_STORAGE_PATH, metadata })
  }
  if (driver === 'cos') {
    return new TencentCosObjectStorage({
      secretId: environment.COS_SECRET_ID,
      secretKey: environment.COS_SECRET_KEY,
      bucket: environment.COS_BUCKET,
      region: environment.COS_REGION,
      metadata,
    })
  }
  throw new Error('Production requires OBJECT_STORAGE_DRIVER=cos; local storage is development-only')
}
