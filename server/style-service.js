import { randomUUID } from 'node:crypto'

export class MemoryStyleStore {
  constructor() { this.styles = new Map() }
}

export class StyleService {
  constructor({ authService, store = new MemoryStyleStore(), maxBytes = 10 * 1024 * 1024 } = {}) {
    if (!authService) throw new Error('authService is required')
    this.authService = authService; this.store = store; this.maxBytes = maxBytes
  }
  list({ sessionToken }) { const user = this.authService.getSession(sessionToken); if (!user) return { ok: false, code: 'UNAUTHORIZED' }; return { ok: true, styles: [...this.store.styles.values()].filter((s) => s.userId === user.id).map(publicStyle) } }
  create({ sessionToken, name, prompt, image }) {
    const user = this.authService.getSession(sessionToken); if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    const bytes = image?.data; if (!String(name ?? '').trim() || !String(prompt ?? '').trim() || !Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > this.maxBytes) return { ok: false, code: 'VALIDATION_ERROR' }
    const style = { id: `style_${randomUUID()}`, userId: user.id, name: String(name).trim().slice(0, 80), prompt: String(prompt).trim().slice(0, 600), image: { type: image.type, data: bytes }, createdAt: Date.now() }
    this.store.styles.set(style.id, style); return { ok: true, style: publicStyle(style) }
  }
}

function publicStyle(style) { return { id: style.id, name: style.name, prompt: style.prompt, image: { type: style.image.type, size: style.image.data.length, dataBase64: style.image.data.toString('base64') }, createdAt: style.createdAt } }
