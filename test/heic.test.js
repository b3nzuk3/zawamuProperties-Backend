import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'
import { optimizeImage, ImageInputError } from '../src/utils/imageOptimizer.js'
import { decodeHeic, HEIC_DECODE_TIMEOUT_MS } from '../src/utils/heicDecoder.js'

const fixture = name => readFile(new URL(`./fixtures/heic/${name}.heic`, import.meta.url))

// Synthetic two-colour images, not client photos. Actual HEVC decoding, no codec mock.
test('HEIC input becomes metadata-free WebP variants without upscaling', async () => {
  const input = await fixture('single')
  assert.equal((await sharp(input).metadata()).compression, 'hevc')
  const variants = await optimizeImage(input)
  assert.deepEqual(variants.map(({ name, width, height }) => [name, width, height]), [
    ['thumbnail', 80, 40], ['card', 80, 40], ['large', 80, 40],
  ])
  for (const { buffer } of variants) {
    const metadata = await sharp(buffer).metadata()
    assert.equal(metadata.format, 'webp')
    assert.equal(metadata.exif, undefined)
    assert.equal(metadata.orientation, undefined)
    assert.equal(metadata.hasProfile, false)
  }
})

test('HEIF intrinsic rotation is applied once, including pixel placement', async () => {
  const variants = await optimizeImage(await fixture('intrinsic-rotation'))
  assert.ok(variants.every(({ width, height }) => width === 40 && height === 80))
  const { data, info } = await sharp(variants[0].buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const top = (10 * info.width + 20) * info.channels
  const bottom = (70 * info.width + 20) * info.channels
  assert.ok(data[top] > 180 && data[top + 2] < 80, 'red half rotates to top')
  assert.ok(data[bottom + 2] > 180 && data[bottom] < 80, 'blue half rotates to bottom')
})

test('HEIF descriptive EXIF orientation is ignored and camera metadata is stripped', async () => {
  const input = await fixture('rotated')
  assert.ok((await sharp(input).metadata()).exif)
  for (const { buffer, width, height } of await optimizeImage(input)) {
    // HEIF presentation uses item transforms (irot/imir), not descriptive EXIF.
    assert.equal(width, 80)
    assert.equal(height, 40)
    assert.equal((await sharp(buffer).metadata()).exif, undefined)
    const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const left = (20 * info.width + 10) * info.channels
    const right = (20 * info.width + 70) * info.channels
    assert.ok(data[left] > 180 && data[left + 2] < 80)
    assert.ok(data[right + 2] > 180 && data[right] < 80)
  }
})

test('multi-image and truncated HEIC remain safe input failures', async () => {
  for (const input of [await fixture('multiple'), (await fixture('single')).subarray(0, 500)]) {
    await assert.rejects(optimizeImage(input), error => {
      assert.ok(error instanceof ImageInputError)
      assert.equal(error.status, 400)
      assert.doesNotMatch(error.message, /wasm|hevc|libheif|plugin|seek|decoder/i)
      return true
    })
  }
})

test('HEIC pixel limit and image-sequence containers fail before conversion', async () => {
  const pixelLimit = await fixture('pixel-limit')
  assert.equal((await sharp(pixelLimit).metadata()).width, 5000)
  await assert.rejects(optimizeImage(pixelLimit), error => error instanceof ImageInputError && error.status === 413)
  const moov = Buffer.from([0, 0, 0, 8, 109, 111, 111, 118])
  await assert.rejects(optimizeImage(Buffer.concat([await fixture('single'), moov])), error => error.status === 400)
})

test('isolated decoder independently enforces dimensions and handles corrupt payloads', async () => {
  await assert.rejects(decodeHeic(await fixture('single'), 100), /Image conversion failed/)
  const corrupt = Buffer.from(await fixture('single'))
  const mdat = corrupt.indexOf('mdat')
  assert.ok(mdat > 0)
  corrupt.fill(0, mdat + 4)
  await assert.rejects(optimizeImage(corrupt), error => error instanceof ImageInputError && error.status === 400)
})

test('decoder deadlines terminate a stuck worker without blocking the event loop', async () => {
  assert.equal(HEIC_DECODE_TIMEOUT_MS, 15_000)
  const workerUrl = new URL('data:text/javascript,setInterval(() => {}, 1000)')
  let ticks = 0
  const timer = setInterval(() => { ticks++ }, 5)
  try {
    await assert.rejects(decodeHeic(Buffer.from('fixture'), 100, { workerUrl, timeoutMs: 100 }), /timed out/)
    assert.ok(ticks > 0)
  } finally { clearInterval(timer) }
  assert.equal((await decodeHeic(await fixture('single'), 3200)).buffer.length, 12800)
})

test('decoder crash, early exit and malformed worker output reject safely', async () => {
  for (const source of [
    'throw new Error("private codec diagnostics")',
    'process.exit(0)',
    'import {parentPort} from "node:worker_threads"; parentPort.postMessage({width:80,height:40,data:new Uint8Array(1)})',
  ]) {
    await assert.rejects(decodeHeic(Buffer.from('fixture'), 3200, {
      workerUrl: new URL(`data:text/javascript,${encodeURIComponent(source)}`),
    }), error => /Image conversion/.test(error.message) && !/private/.test(error.message))
  }
})
