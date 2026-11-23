import http from 'node:http'
import { once } from 'node:events'

export async function serve(app) {
  const server = http.createServer(app)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    server,
    async request(method, path, token, body = {}, contentType = 'application/json', extraHeaders = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        headers: { 'Content-Type': contentType, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
        ...(method === 'GET' ? {} : { body: contentType === 'application/json' ? JSON.stringify(body) : body }),
      })
      const text = await response.text()
      let data
      try { data = JSON.parse(text) } catch { data = text }
      return { status: response.status, data }
    },
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeIdleConnections?.()
    }),
  }
}

// Model-method mocks only: real Express routing, JWT, bcrypt and loopback HTTP.
export function query(value) {
  const result = Promise.resolve(value)
  for (const method of ['sort', 'limit', 'select', 'populate', 'skip']) result[method] = () => result
  return result
}
export function stub(t, target, method, implementation) {
  const original = target[method]
  target[method] = implementation
  t.after(() => { target[method] = original })
}
