import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { createImageStorage, getR2Configuration } from '../src/services/imageStorage.js'

const env = {
  R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'fixture-access',
  R2_SECRET_ACCESS_KEY: 'fixture-secret', R2_BUCKET_NAME: 'fixture-images',
  R2_PUBLIC_URL: 'https://media.example.test/assets/',
}
const image = () => sharp({ create: { width: 1000, height: 500, channels: 3, background: '#267744' } }).png().toBuffer()

test('R2 configuration is explicit, HTTPS-only and never uses default AWS credentials', () => {
  const configured = getR2Configuration(env)
  assert.equal(configured.publicUrl, 'https://media.example.test/assets')
  assert.equal(configured.objectPrefix, 'assets')
  assert.equal(getR2Configuration({ ...env, R2_PUBLIC_URL: 'https://media.example.test/' }).objectPrefix, '')
  assert.equal(configured.endpoint, `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)
  for (const key of Object.keys(env)) assert.equal(getR2Configuration({ ...env, [key]: '' }), null, key)
  for (const url of ['http://media.example.test', 'https://user:pass@media.example.test', 'https://media.example.test/?token=x', 'https://media.example.test/#x', 'https://media.example.test?', 'https://media.example.test\\assets', 'https://media.example.test/%2e%2e/private', 'https://x.r2.cloudflarestorage.com']) {
    assert.equal(getR2Configuration({ ...env, R2_PUBLIC_URL: url }), null, url)
  }
  assert.equal(getR2Configuration({ ...env, R2_ACCOUNT_ID: 'bad/account' }), null)
  assert.equal(getR2Configuration({ ...env, R2_BUCKET_NAME: 'bad/bucket' }), null)
})

test('real WebP variants are sent in input order with immutable keys and safe MIME/cache metadata (S3 mock)', async () => {
  const calls = []
  const client = { async send(command, options) { calls.push(command); assert.ok(options.abortSignal); return {} } }
  const buffer = await image()
  const result = await createImageStorage({ env, client }).uploadImages([{ buffer }, { buffer }])
  assert.equal(result.urls.length, 2)
  assert.equal(new Set(result.urls).size, 2)
  assert.equal(calls.length, 6)
  for (const [i, command] of calls.entries()) {
    assert.equal(command.constructor.name, 'PutObjectCommand')
    assert.equal(command.input.Bucket, env.R2_BUCKET_NAME)
    assert.equal(command.input.ContentType, 'image/webp')
    assert.equal(command.input.CacheControl, 'public, max-age=31536000, immutable')
    assert.equal(command.input.ACL, undefined)
    const keyParts = command.input.Key.split('/')
    assert.deepEqual(keyParts.slice(0, 3), ['assets', 'images', 'v1'])
    assert.match(keyParts[3], /^[a-f0-9-]{36}$/)
    assert.ok(['thumbnail.webp', 'card.webp', 'large.webp'].includes(keyParts[4]))
    const metadata = await sharp(command.input.Body).metadata()
    assert.equal(metadata.format, 'webp')
    assert.equal(metadata.width, [320, 768, 1000][i % 3])
  }
  for (let i = 0; i < 2; i++) {
    assert.equal(result.urls[i], `https://media.example.test/${calls[i * 3 + 2].input.Key}`)
    assert.equal(new URL(result.urls[i]).pathname.slice(1), calls[i * 3 + 2].input.Key)
  }
})

test('root public base keeps the established unprefixed key and URL layout (S3 mock)', async () => {
  const calls = []
  const client = { async send(command) { calls.push(command); return {} } }
  const rootEnv = { ...env, R2_PUBLIC_URL: 'https://media.example.test/' }
  const { urls } = await createImageStorage({ env: rootEnv, client }).uploadImages([{ buffer: await image() }])
  const puts = calls.filter(command => command.constructor.name === 'PutObjectCommand')
  assert.equal(puts.length, 3)
  const keyParts = puts.map(command => command.input.Key.split('/'))
  assert.ok(keyParts.every(parts => parts.length === 4 && parts[0] === 'images' && parts[1] === 'v1' && /^[a-f0-9-]{36}$/.test(parts[2]) && ['thumbnail.webp', 'card.webp', 'large.webp'].includes(parts[3])))
  assert.equal(new URL(urls[0]).pathname.slice(1), puts[2].input.Key)
  assert.equal(urls[0], `https://media.example.test/${puts[2].input.Key}`)
})

test('partial failure rolls back every attempted fresh key, including an uncertain PUT (S3 mock)', async () => {
  const calls = []
  const client = { async send(command) {
    calls.push(command)
    if (command.constructor.name === 'PutObjectCommand' && calls.length === 2) throw new Error('private provider diagnostic fixture-secret')
    return {}
  } }
  await assert.rejects(createImageStorage({ env, client }).uploadImages([{ buffer: await image() }]), error => {
    assert.equal(error.message, 'Image storage is temporarily unavailable')
    assert.equal(error.status, 503)
    assert.equal(error.cleanupIncomplete, false)
    assert.equal(String(error).includes('fixture-secret'), false)
    return true
  })
  const puts = calls.filter(c => c.constructor.name === 'PutObjectCommand')
  const deletes = calls.filter(c => c.constructor.name === 'DeleteObjectCommand')
  assert.deepEqual(deletes.map(c => c.input.Key), puts.map(c => c.input.Key))
})

test('a later invalid image rolls back earlier batch uploads and reports only safe input error', async () => {
  const calls = []
  const client = { async send(command) { calls.push(command); return {} } }
  await assert.rejects(createImageStorage({ env, client }).uploadImages([{ buffer: await image() }, { buffer: Buffer.from('not an image') }]), error => error.status === 400)
  assert.equal(calls.filter(c => c.constructor.name === 'PutObjectCommand').length, 3)
  assert.equal(calls.filter(c => c.constructor.name === 'DeleteObjectCommand').length, 3)
})

test('missing configuration never attempts transport and failed cleanup is marked without raw diagnostics', async () => {
  let calls = 0
  const client = { async send() { calls++; throw new Error('private fixture-secret') } }
  await assert.rejects(createImageStorage({ env: {}, client }).uploadImages([{ buffer: Buffer.from('x') }]), error => error.status === 503)
  assert.equal(calls, 0)
  await assert.rejects(createImageStorage({ env, client }).uploadImages([{ buffer: await image() }]), error => error.cleanupIncomplete === true && error.status === 503 && !String(error).includes('fixture-secret'))
  assert.equal(calls, 2)
})
