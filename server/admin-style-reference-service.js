import { randomUUID } from 'node:crypto'

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png'])
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png' }
export const ADMIN_STYLE_REFERENCE_MAX_BYTES = 10 * 1024 * 1024

export class MemoryAdminStyleReferenceStore {
  constructor() { this.references = new Map() }
  transaction(work) { return work() }
}

function publicReference(reference, { includeDisabled = false } = {}) {
  if (!includeDisabled && !reference.enabled) return null
  return {
    id: reference.id,
    name: reference.name,
    theme: reference.theme,
    description: reference.description,
    image: { url: `/api/objects/${encodeURIComponent(reference.objectKey)}`, mimeType: reference.mimeType },
    enabled: reference.enabled,
    createdAt: reference.createdAt,
    updatedAt: reference.updatedAt,
  }
}

export class AdminStyleReferenceService {
  constructor({ authService, store = new MemoryAdminStyleReferenceStore(), objectStorage, isAdmin, clock = () => Date.now(), maxBytes = ADMIN_STYLE_REFERENCE_MAX_BYTES } = {}) {
    if (!authService || typeof isAdmin !== 'function') throw new Error('authService and isAdmin are required')
    this.authService = authService
    this.store = store
    this.objectStorage = objectStorage
    this.isAdmin = isAdmin
    this.clock = clock
    this.maxBytes = maxBytes
  }

  list({ sessionToken }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    return { ok: true, styleReferences: [...this.store.references.values()].map((reference) => publicReference(reference, { includeDisabled: true })).filter(Boolean) }
  }

  listPublic({ sessionToken }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    return { ok: true, styleReferences: [...this.store.references.values()].map((reference) => publicReference(reference)).filter(Boolean) }
  }

  async create({ sessionToken, name, theme, description, image }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    if (!this.objectStorage) return { ok: false, code: 'STORAGE_UNAVAILABLE' }
    const values = this.#validate({ name, theme, description, image })
    if (values) return { ok: false, code: 'VALIDATION_ERROR', fields: values }
    const id = `style_reference_${randomUUID()}`
    const objectKey = `style-references/${id}.${EXTENSIONS[image.type]}`
    await this.objectStorage.put({ key: objectKey, body: image.data, mimeType: image.type, ownerId: null, metadata: { kind: 'admin-style-reference', referenceId: id } })
    const now = this.clock()
    const reference = { id, name: String(name).trim().slice(0, 80), theme: String(theme).trim().slice(0, 40), description: String(description ?? '').trim().slice(0, 300), objectKey, mimeType: image.type, enabled: true, createdAt: now, updatedAt: now }
    this.store.transaction(() => this.store.references.set(id, reference))
    return { ok: true, styleReference: publicReference(reference, { includeDisabled: true }) }
  }

  setEnabled({ sessionToken, referenceId, enabled }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    if (typeof enabled !== 'boolean') return { ok: false, code: 'VALIDATION_ERROR', fields: { enabled: 'enabled must be boolean' } }
    const reference = this.store.references.get(referenceId)
    if (!reference) return { ok: false, code: 'NOT_FOUND' }
    const updated = { ...reference, enabled, updatedAt: this.clock() }
    this.store.transaction(() => this.store.references.set(referenceId, updated))
    return { ok: true, styleReference: publicReference(updated, { includeDisabled: true }) }
  }

  remove({ sessionToken, referenceId }) {
    return this.setEnabled({ sessionToken, referenceId, enabled: false })
  }

  #authorize(sessionToken) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    if (!this.isAdmin(user)) return { ok: false, code: 'FORBIDDEN' }
    return { ok: true, user }
  }

  #validate({ name, theme, description, image }) {
    const fields = {}
    if (!String(name ?? '').trim()) fields.name = 'name is required'
    if (!String(theme ?? '').trim()) fields.theme = 'theme is required'
    if (description !== undefined && typeof description !== 'string') fields.description = 'description must be text'
    if (!image || !ALLOWED_MIME_TYPES.has(image.type) || !Buffer.isBuffer(image.data) || image.data.length === 0) fields.image = 'image must be JPEG or PNG'
    else if (image.data.length > this.maxBytes) fields.image = 'image is too large'
    return Object.keys(fields).length ? fields : null
  }
}

export const adminStyleReferenceConstants = { ALLOWED_MIME_TYPES, ADMIN_STYLE_REFERENCE_MAX_BYTES }
