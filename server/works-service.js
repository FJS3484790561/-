import { randomUUID } from 'node:crypto'

export class MemoryWorksStore {
  constructor() {
    this.works = new Map()
  }

  transaction(work) {
    return work()
  }
}

export class WorksService {
  constructor({ authService, store = new MemoryWorksStore(), clock = () => Date.now() } = {}) {
    if (!authService) throw new Error('authService is required')
    this.authService = authService
    this.store = store
    this.clock = clock
  }

  create({ sessionToken, generationId, original, effectImage, params }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    if (!generationId || !original?.url || !effectImage?.url || !params) return { ok: false, code: 'INVALID_WORK' }
    const work = { id: `work_${randomUUID()}`, userId: user.id, generationId, original: { url: String(original.url), mimeType: original.mimeType ?? null }, effectImage: { url: String(effectImage.url), mimeType: effectImage.mimeType ?? null }, params: { ...params, preferences: { ...(params.preferences ?? {}) } }, createdAt: this.clock() }
    this.store.works.set(work.id, work)
    return { ok: true, work: this.#publicWork(work) }
  }

  list({ sessionToken }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    const works = [...this.store.works.values()].filter((work) => work.userId === user.id).sort((left, right) => right.createdAt - left.createdAt)
    return { ok: true, works: works.map((work) => this.#publicWork(work)) }
  }

  get({ sessionToken, workId }) {
    const user = this.authService.getSession(sessionToken)
    if (!user) return { ok: false, code: 'UNAUTHORIZED' }
    const work = this.store.works.get(workId)
    if (!work || work.userId !== user.id) return { ok: false, code: 'NOT_FOUND' }
    return { ok: true, work: this.#publicWork(work) }
  }

  #publicWork(work) {
    return { id: work.id, generationId: work.generationId, original: { ...work.original }, effectImage: { ...work.effectImage }, params: { ...work.params, preferences: { ...(work.params.preferences ?? {}) } }, createdAt: work.createdAt }
  }
}
