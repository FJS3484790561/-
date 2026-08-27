import { createServer } from 'node:http'
import { Readable } from 'node:stream'

export function createAppHttpServer({ api }) {
  if (!api) throw new Error('api is required')
  return createServer(async (incoming, outgoing) => {
    const origin = `http://${incoming.headers.host ?? '127.0.0.1'}`
    const body = incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : Readable.toWeb(incoming)
    const request = new Request(new URL(incoming.url ?? '/', origin), { method: incoming.method, headers: incoming.headers, body, ...(body ? { duplex: 'half' } : {}) })
    const response = await api.handle(request, { clientAddress: incoming.socket.remoteAddress ?? 'unknown' })
    outgoing.statusCode = response.status
    for (const [name, value] of response.headers) outgoing.setHeader(name, value)
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing)
    else outgoing.end()
  })
}
