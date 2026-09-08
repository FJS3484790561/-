import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'

function normalizeAddress(value) {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  const normalized = candidate.startsWith('::ffff:') ? candidate.slice(7) : candidate
  return isIP(normalized) ? normalized : undefined
}

export function resolveClientAddress(incoming) {
  const remoteAddress = normalizeAddress(incoming.socket?.remoteAddress)
  const fromLoopbackProxy = remoteAddress === '127.0.0.1' || remoteAddress === '::1'
  const realIpHeader = incoming.headers?.['x-real-ip']
  if (fromLoopbackProxy && typeof realIpHeader === 'string' && !realIpHeader.includes(',')) {
    return normalizeAddress(realIpHeader) ?? remoteAddress
  }
  return remoteAddress ?? 'unknown'
}

export function createAppHttpServer({ api }) {
  if (!api) throw new Error('api is required')
  return createServer(async (incoming, outgoing) => {
    const origin = `http://${incoming.headers.host ?? '127.0.0.1'}`
    const body = incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : Readable.toWeb(incoming)
    const request = new Request(new URL(incoming.url ?? '/', origin), { method: incoming.method, headers: incoming.headers, body, ...(body ? { duplex: 'half' } : {}) })
    const response = await api.handle(request, { clientAddress: resolveClientAddress(incoming) })
    outgoing.statusCode = response.status
    for (const [name, value] of response.headers) outgoing.setHeader(name, value)
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing)
    else outgoing.end()
  })
}
