import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import sharp from 'sharp'
import { S3Client } from '@aws-sdk/client-s3'
import User from '../src/models/User.js'
import { serve, stub, query } from './helpers/http.js'
import { createUploadRouter } from '../src/routes/upload.js'

async function setup(t, storeImages) {
  const configured = { JWT_SECRET: 'upload-local-fixture', ADMIN_EMAILS: 'owner@example.test', R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'fixture-access', R2_SECRET_ACCESS_KEY: 'fixture-secret', R2_BUCKET_NAME: 'fixture-images', R2_PUBLIC_URL: 'https://media.example.test' }
  const previous = Object.fromEntries(Object.keys(configured).map(key => [key, process.env[key]]))
  Object.assign(process.env, configured)
  t.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value })
  let email = 'owner@example.test'
  stub(t, User, 'findById', () => query({ _id: 'actor', email }))
  const calls = []
  stub(t, S3Client.prototype, 'send', async function(command) { calls.push(command); return {} })
  const app = express()
  app.use('/api/upload', createUploadRouter(storeImages ? { storeImages } : {}))
  const api = await serve(app)
  t.after(api.close)
  const token = jwt.sign({ userId: 'actor' }, process.env.JWT_SECRET)
  return { calls, actor: value => { email = value }, async upload(body, authorized = true, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${api.server.address().port}/api/upload`, {
      method: 'POST', body, headers: { ...(authorized ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    })
    return { status: response.status, data: await response.json(), headers: response.headers }
  } }
}
const png = () => sharp({ create: { width: 900, height: 600, channels: 3, background: 'red' } }).png().toBuffer()
function multipart(buffers, field = 'images', type = 'image/png') {
  const form = new FormData()
  for (const buffer of buffers) form.append(field, new Blob([buffer], { type }), '../../untrusted-name.png')
  return form
}

test('owner multipart upload actually decodes WebP and keeps the existing ordered urls response (S3 mock)', async t => {
  const api = await setup(t)
  const result = await api.upload(multipart([await png(), await png()]))
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.deepEqual(Object.keys(result.data), ['urls'])
  assert.equal(result.data.urls.length, 2)
  assert.equal(api.calls.length, 6)
  for (const url of result.data.urls) assert.match(url, /^https:\/\/media\.example\.test\/images\/v1\/[a-f0-9-]{36}\/large\.webp$/)
  for (const command of api.calls) assert.equal((await sharp(command.input.Body).metadata()).format, 'webp')
})

test('anonymous and ordinary callers fail before malformed multipart parsing or any S3 call', async t => {
  const api = await setup(t)
  const headers = { 'Content-Type': 'multipart/form-data; boundary=broken' }
  assert.equal((await api.upload('malformed', false, headers)).status, 401)
  api.actor('ordinary@example.test')
  assert.equal((await api.upload('malformed', true, headers)).status, 403)
  assert.equal(api.calls.length, 0)
})

test('missing, excessive, wrong-field, oversized and malformed multipart requests return safe JSON', async t => {
  const api = await setup(t)
  assert.equal((await api.upload(new FormData())).status, 400)
  assert.equal((await api.upload(multipart(Array(11).fill(Buffer.from('x'))))).status, 400)
  assert.equal((await api.upload(multipart([Buffer.from('x')], 'other'))).status, 400)
  assert.equal((await api.upload(multipart([Buffer.alloc(8 * 1024 * 1024 + 1)]))).status, 413)
  const malformed = await api.upload('malformed', true, { 'Content-Type': 'multipart/form-data; boundary=broken' })
  assert.equal(malformed.status, 400)
  assert.equal(api.calls.length, 0)
})

test('exactly ten images are accepted without tripping multipart part-count limits', async t => {
  const api = await setup(t, async files => ({ urls: files.map(() => 'https://media.example.test/fixture.webp') }))
  const result = await api.upload(multipart(Array(10).fill(Buffer.from('fixture'))))
  assert.equal(result.status, 200)
  assert.equal(result.data.urls.length, 10)
})

test('multipart byte boundary accepts exactly 8 MiB and rejects one byte over', async t => {
  const api = await setup(t, async files => ({ urls: files.map(file => String(file.buffer.length)) }))
  const atLimit = await api.upload(multipart([Buffer.alloc(8 * 1024 * 1024)]))
  assert.equal(atLimit.status, 200)
  assert.deepEqual(atLimit.data.urls, [String(8 * 1024 * 1024)])
  assert.equal((await api.upload(multipart([Buffer.alloc(8 * 1024 * 1024 + 1)]))).status, 413)
})

test('forged image MIME and corrupt bytes are rejected; missing R2 config fails safely', async t => {
  const api = await setup(t)
  const corrupt = await api.upload(multipart([Buffer.from('<svg>not a raster image</svg>')]))
  assert.equal(corrupt.status, 400)
  assert.equal(api.calls.length, 0)
  delete process.env.R2_SECRET_ACCESS_KEY
  const missing = await api.upload(multipart([await png()]))
  assert.equal(missing.status, 503)
  assert.equal(JSON.stringify(missing.data).includes('fixture'), false)
  assert.equal(api.calls.length, 0)
})

test('provider error is sanitized and compensation reaches all attempted new keys', async t => {
  const api = await setup(t)
  const calls = []
  stub(t, S3Client.prototype, 'send', async function(command) {
    calls.push(command)
    if (command.constructor.name === 'PutObjectCommand') throw new Error('SECRET internal endpoint fixture-secret')
    return {}
  })
  const result = await api.upload(multipart([await png()]))
  assert.equal(result.status, 503)
  assert.deepEqual(result.data, { message: 'Image storage is temporarily unavailable' })
  assert.deepEqual(calls.map(c => c.constructor.name), ['PutObjectCommand', 'DeleteObjectCommand'])
})

test('only one parsed batch runs at a time and capacity is released after completion and failure', async t => {
  let release
  let entered
  const started = new Promise(resolve => { entered = resolve })
  let calls = 0
  const api = await setup(t, async () => {
    calls++
    if (calls === 1) { entered(); await new Promise(resolve => { release = resolve }) }
    if (calls === 2) throw new Error('private detail')
    return { urls: ['https://media.example.test/fixture.webp'] }
  })
  const pending = api.upload(multipart([Buffer.from('fixture')]))
  await started
  const busy = await api.upload('malformed', true, { 'Content-Type': 'multipart/form-data; boundary=broken' })
  assert.equal(busy.status, 503)
  assert.equal(busy.headers.get('retry-after'), '5')
  release()
  assert.equal((await pending).status, 200)
  assert.equal((await api.upload(multipart([Buffer.from('fixture')]))).status, 503)
  assert.equal((await api.upload(multipart([Buffer.from('fixture')]))).status, 200)
})
