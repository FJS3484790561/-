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
    position: Number.isFinite(reference.position) ? reference.position : null,
    image: { url: `/api/objects/${encodeURIComponent(reference.objectKey)}`, mimeType: reference.mimeType },
    enabled: reference.enabled,
    createdAt: reference.createdAt,
    updatedAt: reference.updatedAt,
  }
}

function sortedReferences(store) {
  return [...store.references.values()].sort((left, right) => {
    const leftPosition = Number.isFinite(left.position) ? left.position : Number.MAX_SAFE_INTEGER
    const rightPosition = Number.isFinite(right.position) ? right.position : Number.MAX_SAFE_INTEGER
    return leftPosition - rightPosition || left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  })
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
    return { ok: true, styleReferences: sortedReferences(this.store).map((reference) => publicReference(reference, { includeDisabled: true })).filter(Boolean) }
  }

  listPublic({ sessionToken }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    return { ok: true, styleReferences: sortedReferences(this.store).map((reference) => publicReference(reference)).filter(Boolean) }
  }

  async create({ sessionToken, name, theme, description, image }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    if (!this.objectStorage) return { ok: false, code: 'STORAGE_UNAVAILABLE' }
    const values = this.#validate({ name, theme, description, image })
    if (values) return { ok: false, code: 'VALIDATION_ERROR', fields: values }
    if (this.#themeExists(theme)) return { ok: false, code: 'STYLE_ALREADY_EXISTS', fields: { theme: '该风格已存在' } }
    const id = `style_reference_${randomUUID()}`
    const objectKey = `style-references/${id}.${EXTENSIONS[image.type]}`
    await this.objectStorage.put({ key: objectKey, body: image.data, mimeType: image.type, ownerId: null, metadata: { kind: 'admin-style-reference', referenceId: id } })
    const now = this.clock()
    const position = sortedReferences(this.store).reduce((maximum, entry) => Math.max(maximum, Number.isFinite(entry.position) ? entry.position : -1), -1) + 1
    const reference = { id, name: String(name).trim().slice(0, 80), theme: String(theme).trim().slice(0, 40), description: String(description ?? '').trim().slice(0, 300), objectKey, mimeType: image.type, enabled: true, position, createdAt: now, updatedAt: now }
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

  async update({ sessionToken, referenceId, name, theme, description, image }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    const reference = this.store.references.get(referenceId)
    if (!reference) return { ok: false, code: 'NOT_FOUND' }
    const fields = this.#validate({ name, theme, description, image }, { imageRequired: false })
    if (fields) return { ok: false, code: 'VALIDATION_ERROR', fields }
    if (this.#themeExists(theme, referenceId)) return { ok: false, code: 'STYLE_ALREADY_EXISTS', fields: { theme: '该风格已存在' } }
    let objectKey = reference.objectKey
    let mimeType = reference.mimeType
    if (image) {
      if (!this.objectStorage) return { ok: false, code: 'STORAGE_UNAVAILABLE' }
      objectKey = `style-references/${referenceId}-${randomUUID()}.${EXTENSIONS[image.type]}`
      await this.objectStorage.put({ key: objectKey, body: image.data, mimeType: image.type, ownerId: null, metadata: { kind: 'admin-style-reference', referenceId } })
      mimeType = image.type
    }
    const updated = {
      ...reference,
      name: String(name).trim().slice(0, 80),
      theme: String(theme).trim().slice(0, 40),
      description: String(description ?? '').trim().slice(0, 300),
      objectKey,
      mimeType,
      updatedAt: this.clock(),
    }
    this.store.transaction(() => this.store.references.set(referenceId, updated))
    return { ok: true, styleReference: publicReference(updated, { includeDisabled: true }) }
  }

  reorder({ sessionToken, referenceIds }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    const current = sortedReferences(this.store)
    if (!Array.isArray(referenceIds) || referenceIds.length !== current.length || new Set(referenceIds).size !== current.length || referenceIds.some((id) => !this.store.references.has(id))) {
      return { ok: false, code: 'VALIDATION_ERROR', fields: { referenceIds: '排序列表与当前风格不一致' } }
    }
    const now = this.clock()
    this.store.transaction(() => {
      referenceIds.forEach((id, position) => {
        const reference = this.store.references.get(id)
        this.store.references.set(id, { ...reference, position, updatedAt: now })
      })
    })
    return { ok: true, styleReferences: sortedReferences(this.store).map((reference) => publicReference(reference, { includeDisabled: true })) }
  }

  remove({ sessionToken, referenceId }) {
    const access = this.#authorize(sessionToken)
    if (!access.ok) return access
    const reference = this.store.references.get(referenceId)
    if (!reference) return { ok: false, code: 'NOT_FOUND' }
    this.store.transaction(() => {
      this.store.references.delete(referenceId)
      sortedReferences(this.store).forEach((entry, position) => this.store.references.set(entry.id, { ...entry, position }))
    })
    return { ok: true, deleted: true, styleReference: publicReference(reference, { includeDisabled: true }) }
  }

  #authorize(sessionToken) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    if (!this.isAdmin(user)) return { ok: false, code: 'FORBIDDEN' }
    return { ok: true, user }
  }

  #validate({ name, theme, description, image }, { imageRequired = true } = {}) {
    const fields = {}
    if (!String(name ?? '').trim()) fields.name = 'name is required'
    if (!String(theme ?? '').trim()) fields.theme = 'theme is required'
    if (description !== undefined && typeof description !== 'string') fields.description = 'description must be text'
    if ((imageRequired || image) && (!image || !ALLOWED_MIME_TYPES.has(image.type) || !Buffer.isBuffer(image.data) || image.data.length === 0)) fields.image = 'image must be JPEG or PNG'
    else if (image?.data.length > this.maxBytes) fields.image = 'image is too large'
    return Object.keys(fields).length ? fields : null
  }

  #themeExists(theme, exceptId = null) {
    const normalized = String(theme ?? '').trim().toLocaleLowerCase('zh-CN')
    return [...this.store.references.values()].some((reference) => reference.id !== exceptId && reference.theme.trim().toLocaleLowerCase('zh-CN') === normalized)
  }
}

export const adminStyleReferenceConstants = { ALLOWED_MIME_TYPES, ADMIN_STYLE_REFERENCE_MAX_BYTES }
