import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import express from 'express'
import jwt from 'jsonwebtoken'
import sharp from 'sharp'
import { S3Client } from '@aws-sdk/client-s3'
import User from '../src/models/User.js'
import { createImageStorage } from '../src/services/imageStorage.js'
import { createUploadRouter } from '../src/routes/upload.js'
import { serve, stub, query } from './helpers/http.js'

// Real SDK HTTP requests and real Sharp codec. This is a tiny in-memory S3 wire
// fixture, NOT Cloudflare R2, Mongo persistence or proof of provider credentials.
test('real multipart → Sharp → AWS signed HTTP PUT → local object read-back and compensation', async t => {
  const objects = new Map()
  const received = []
  let failCard = false
  const store = http.createServer(async (req, res) => {
    const objectPath = new URL(req.url, 'http://fixture.invalid').pathname
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    received.push({ method: req.method, path: req.url, mime: req.headers['content-type'], cache: req.headers['cache-control'], signed: /^AWS4-HMAC-SHA256 /.test(req.headers.authorization ?? '') })
    if (req.method === 'PUT') {
      if (failCard && objectPath.endsWith('/card.webp')) {
        res.writeHead(503, { 'Content-Type': 'application/xml' })
        return res.end('<Error><Code>ServiceUnavailable</Code></Error>')
      }
      objects.set(objectPath, body)
      res.writeHead(200, { ETag: '"fixture-etag"' })
    } else if (req.method === 'DELETE') {
      objects.delete(objectPath)
      res.writeHead(204)
    } else if (req.method === 'GET' && objects.has(objectPath)) {
      res.writeHead(200, { 'Content-Type': 'image/webp' })
      return res.end(objects.get(objectPath))
    } else res.writeHead(404)
    res.end()
  })
  store.listen(0, '127.0.0.1')
  await once(store, 'listening')
  t.after(() => new Promise(resolve => { store.close(resolve); store.closeIdleConnections() }))
  const endpoint = `http://127.0.0.1:${store.address().port}`
  const env = { R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'local-fixture', R2_SECRET_ACCESS_KEY: 'local-fixture-secret', R2_BUCKET_NAME: 'fixture-images', R2_PUBLIC_URL: 'https://media.example.test/assets' }
  const client = new S3Client({ region: 'auto', endpoint, forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
  t.after(() => client.destroy())
  const storage = createImageStorage({ env, client })
  const previous = { ADMIN_EMAILS: process.env.ADMIN_EMAILS, JWT_SECRET: process.env.JWT_SECRET }
  Object.assign(process.env, { ADMIN_EMAILS: 'owner@example.test', JWT_SECRET: 'local-only-fixture' })
  t.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value })
  stub(t, User, 'findById', () => query({ _id: 'actor', email: 'owner@example.test' }))
  const app = express()
  app.use('/api/upload', createUploadRouter({ storeImages: files => storage.uploadImages(files) }))
  const api = await serve(app)
  t.after(api.close)
  const buffer = await sharp({ create: { width: 1800, height: 1200, channels: 4, background: '#18a85c80' } }).png().toBuffer()
  async function upload(input = buffer, type = 'image/png') {
    const form = new FormData()
    form.append('images', new Blob([input], { type }), 'phone-upload')
    const response = await fetch(`http://127.0.0.1:${api.server.address().port}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${jwt.sign({ userId: 'actor' }, process.env.JWT_SECRET)}` }, body: form })
    return { status: response.status, data: await response.json() }
  }
  const result = await upload()
  assert.equal(result.status, 200)
  assert.equal(result.data.urls.length, 1)
  assert.equal(objects.size, 3)
  const canonicalUrl = new URL(result.data.urls[0])
  const canonicalPath = canonicalUrl.pathname
  const canonicalKey = canonicalPath.slice(1)
  const uploadedKeys = received.filter(row => row.method === 'PUT').map(row => {
    const path = new URL(row.path, 'http://fixture.invalid').pathname
    return path.slice('/fixture-images/'.length)
  })
  assert.equal(canonicalKey, uploadedKeys.find(key => key.endsWith('/large.webp')))
  assert.ok(canonicalKey.startsWith('assets/images/v1/'))
  for (const [name, width] of [['thumbnail', 320], ['card', 768], ['large', 1600]]) {
    const key = canonicalKey.replace('large.webp', `${name}.webp`)
    const path = `/fixture-images/${key}`
    assert.ok(objects.has(path), `expected object key ${key}`)
    const response = await fetch(`${endpoint}${path}`)
    assert.equal(response.status, 200)
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
    assert.equal(metadata.format, 'webp')
    assert.equal(metadata.width, width)
    assert.equal(metadata.hasAlpha, true)
    assert.equal(metadata.exif, undefined)
  }
  const heic = await readFile(new URL('./fixtures/heic/intrinsic-rotation.heic', import.meta.url))
  const heicResult = await upload(heic, 'image/heic')
  assert.equal(heicResult.status, 200)
  const heicPath = new URL(heicResult.data.urls[0]).pathname
  for (const name of ['thumbnail', 'card', 'large']) {
    const response = await fetch(`${endpoint}/fixture-images${heicPath.replace('large.webp', `${name}.webp`)}`)
    assert.equal(response.status, 200)
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
    assert.equal(metadata.format, 'webp')
    assert.equal(metadata.width, 40)
    assert.equal(metadata.height, 80)
    assert.equal(metadata.exif, undefined)
  }
  for (const request of received.filter(row => row.method === 'PUT')) {
    assert.equal(request.signed, true)
    assert.equal(request.mime, 'image/webp')
    assert.equal(request.cache, 'public, max-age=31536000, immutable')
  }
  const retainedKeys = [...objects.keys()]
  assert.equal(retainedKeys.length, 6)
  assert.ok(retainedKeys.every(key => key.startsWith('/fixture-images/assets/')))
  failCard = true
  assert.equal((await upload(heic, 'image/heic')).status, 503)
  assert.deepEqual([...objects.keys()], retainedKeys)
  const deletes = received.filter(row => row.method === 'DELETE')
  assert.equal(deletes.length, 2)
  assert.ok(deletes.every(row => new URL(row.path, 'http://fixture.invalid').pathname.startsWith('/fixture-images/assets/')))
  // Fixture object cleanup is independent of all provider/production state.
  objects.clear()
  assert.equal(objects.size, 0)
})
