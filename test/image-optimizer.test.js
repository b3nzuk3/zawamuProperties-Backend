import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  IMAGE_VARIANTS,
  ImageInputError,
  optimizeImage,
} from '../src/utils/imageOptimizer.js'

const makeImage = async (width, height, format, options = {}) => {
  const image = sharp({
    create: {
      width,
      height,
      channels: options.channels ?? 3,
      background: options.background ?? '#336699',
    },
  })
  if (options.orientation || options.exif) {
    return image.jpeg().withMetadata({
      ...(options.orientation ? { orientation: options.orientation } : {}),
      ...(options.exif ? { exif: options.exif } : {}),
    }).toBuffer()
  }
  return image[format]().toBuffer()
}

const makePixelLimitPng = png => {
  const buffer = Buffer.from(png)
  const width = 5000
  const height = 5000
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  buffer.writeUInt32BE(crc32(buffer.subarray(12, 29)), 29)
  return buffer
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

const animatedWebp = Buffer.from(
  'UklGRsAAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAD/////AABBTk1GSAAAAAAAAAAAAAEAAAEAAGQAAAJWUDggMAAAANABAJ0BKgIAAgACADQloAJ0ugH4AAOwAP7wxAv/ILlhdcjX/yA/5Af8gP/48gAAAEFOTUZEAAAAAAAAAAAAAQAAAQAAZAAAAFZQOCAsAAAAlAEAnQEqAgACAAAANCWgAnS6AAOYAP75k2//kB//kB//kB//ID/iF3sgMAA=',
  'base64',
)
const onePixelGif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64')

const fixtures = await (async () => {
  const png = await makeImage(2400, 1200, 'png')
  const jpeg = await makeImage(800, 400, 'jpeg')
  const exifJpeg = await makeImage(40, 20, 'jpeg', {
    orientation: 6,
    exif: { IFD0: { Make: 'Fixture Camera', Model: 'Fixture Model' }, GPS: { GPSLatitude: '1,2,3' } },
  })
  const avif = await sharp({
    create: { width: 12, height: 8, channels: 3, background: '#885522' },
  }).avif().toBuffer()
  const unsupportedTiff = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#885522' },
  }).tiff().toBuffer()
  const alphaPng = await sharp(Buffer.from([
    255, 0, 0, 0,
    0, 255, 0, 255,
  ]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer()
  return { png, jpeg, exifJpeg, avif, unsupportedTiff, alphaPng }
})()

function assertSafeImageError(error, statuses = [400, 413]) {
  assert.ok(error instanceof ImageInputError)
  assert.ok(statuses.includes(error.status))
  assert.doesNotMatch(error.message, /sharp|libvips|vips|pngload|jpegload|heifload/i)
}

test('exports the bounded image limits and variant dimensions', () => {
  assert.equal(IMAGE_MAX_BYTES, 8 * 1024 * 1024)
  assert.equal(IMAGE_MAX_PIXELS, 24_000_000)
  assert.deepEqual(IMAGE_VARIANTS, { thumbnail: 320, card: 768, large: 1600 })
})

test('optimizes real generated PNG and JPEG inputs to ordered WebP variants', async () => {
  for (const input of [fixtures.png, fixtures.jpeg]) {
    const variants = await optimizeImage(input)
    assert.deepEqual(variants.map(({ name }) => name), ['thumbnail', 'card', 'large'])
    for (const variant of variants) {
      assert.ok(Buffer.isBuffer(variant.buffer))
      assert.equal(variant.buffer.length > 0, true)
      assert.equal(variant.width > 0, true)
      assert.equal(variant.height > 0, true)
      assert.equal((await sharp(variant.buffer).metadata()).format, 'webp')
    }
  }
})

test('resizes within each bounding square while preserving aspect ratio', async () => {
  const variants = await optimizeImage(fixtures.png)
  assert.deepEqual(variants.map(({ width, height }) => [width, height]), [
    [320, 160],
    [768, 384],
    [1600, 800],
  ])
})

test('does not upscale images smaller than every variant bound', async () => {
  const smallJpeg = await makeImage(50, 30, 'jpeg')
  const variants = await optimizeImage(smallJpeg)
  assert.deepEqual(variants.map(({ width, height }) => [width, height]), [
    [50, 30],
    [50, 30],
    [50, 30],
  ])
})

test('accepts real WebP and AVIF inputs and re-encodes them as WebP', async () => {
  const webp = await sharp(fixtures.jpeg).webp().toBuffer()
  for (const input of [webp, fixtures.avif]) {
    const variants = await optimizeImage(input)
    assert.equal((await sharp(variants[0].buffer).metadata()).format, 'webp')
  }
})

test('auto-rotates EXIF orientation and strips camera/GPS metadata', async () => {
  assert.equal((await sharp(fixtures.exifJpeg).metadata()).orientation, 6)
  const variants = await optimizeImage(fixtures.exifJpeg)
  const large = variants.find(({ name }) => name === 'large')
  assert.equal(large.width, 20)
  assert.equal(large.height, 40)
  const outputMetadata = await sharp(large.buffer).metadata()
  assert.equal(outputMetadata.format, 'webp')
  assert.equal(outputMetadata.orientation, undefined)
  assert.equal(outputMetadata.exif, undefined)
})

test('preserves transparency from PNG input', async () => {
  const [thumbnail] = await optimizeImage(fixtures.alphaPng)
  const { data, info } = await sharp(thumbnail.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.channels, 4)
  assert.equal(data[3], 0)
  assert.equal(data[7], 255)
})

test('rejects inputs that exceed the byte limit with a safe 413 error', async () => {
  const oversized = Buffer.alloc(IMAGE_MAX_BYTES + 1)
  await assert.rejects(optimizeImage(oversized), error => {
    assertSafeImageError(error, [413])
    return true
  })
})

test('rejects inputs whose decoded dimensions exceed the pixel limit', async () => {
  const oversizedPixels = makePixelLimitPng(fixtures.png)
  assert.equal(5000 * 5000 > IMAGE_MAX_PIXELS, true)
  await assert.rejects(optimizeImage(oversizedPixels), error => {
    assertSafeImageError(error)
    return true
  })
})

test('rejects GIF input', async () => {
  await assert.rejects(optimizeImage(onePixelGif), error => {
    assertSafeImageError(error, [400])
    return true
  })
})

test('rejects animated WebP input instead of silently taking a frame', async () => {
  assert.ok((await sharp(animatedWebp).metadata()).pages > 1)
  await assert.rejects(optimizeImage(animatedWebp), error => {
    assertSafeImageError(error, [400])
    return true
  })
})

test('rejects SVG input', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>')
  await assert.rejects(optimizeImage(svg), error => {
    assertSafeImageError(error, [400])
    return true
  })
})

test('rejects unsupported decoded formats', async () => {
  await assert.rejects(optimizeImage(fixtures.unsupportedTiff), error => {
    assertSafeImageError(error, [400])
    return true
  })
})

test('rejects corrupt and truncated images with safe errors', async t => {
  await t.test('corrupt bytes', async () => {
    await assert.rejects(optimizeImage(Buffer.from('not an image')), error => {
      assertSafeImageError(error, [400])
      return true
    })
  })
  await t.test('truncated PNG', async () => {
    await assert.rejects(optimizeImage(fixtures.png.subarray(0, fixtures.png.length - 12)), error => {
      assertSafeImageError(error, [400])
      return true
    })
  })
})

test('ImageInputError defaults to 400 and supports an explicit 413', () => {
  assert.equal(new ImageInputError('Invalid image').status, 400)
  assert.equal(new ImageInputError('Image too large', 413).status, 413)
})
