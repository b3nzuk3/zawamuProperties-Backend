import sharp from 'sharp'

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const IMAGE_MAX_PIXELS = 24_000_000
export const IMAGE_VARIANTS = Object.freeze({
  thumbnail: 320,
  card: 768,
  large: 1600,
})

const INVALID_IMAGE_MESSAGE = 'Image is invalid or unsupported'
const IMAGE_TOO_LARGE_MESSAGE = 'Image exceeds the allowed limits'
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif'])
const WEBP_OPTIONS = Object.freeze({ quality: 80, effort: 4 })
const ENCODE_TIMEOUT_SECONDS = 15

export class ImageInputError extends Error {
  constructor(message = INVALID_IMAGE_MESSAGE, status = 400) {
    super(message)
    this.name = 'ImageInputError'
    this.status = status
  }
}

function getInputFormat(metadata) {
  if (metadata.format === 'heif' && metadata.compression === 'av1') return 'avif'
  return metadata.format
}

function hasCompleteContainer(buffer, format) {
  if (format === 'jpeg') {
    return buffer.length >= 2 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9
  }

  if (format === 'webp') {
    return buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.readUInt32LE(4) + 8 === buffer.length &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
  }

  if (format === 'png') {
    if (buffer.length < 8 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return false
    let offset = 8
    while (offset + 12 <= buffer.length) {
      const chunkLength = buffer.readUInt32BE(offset)
      const chunkEnd = offset + 12 + chunkLength
      if (chunkEnd > buffer.length) return false
      const chunkType = buffer.toString('ascii', offset + 4, offset + 8)
      if (chunkType === 'IEND') return chunkLength === 0
      offset = chunkEnd
    }
    return false
  }

  if (format === 'avif') {
    let offset = 0
    while (offset + 8 <= buffer.length) {
      const boxLength = buffer.readUInt32BE(offset)
      let headerLength = 8
      let boxSize = BigInt(boxLength)
      if (boxLength === 1) {
        if (offset + 16 > buffer.length) return false
        boxSize = buffer.readBigUInt64BE(offset + 8)
        headerLength = 16
      } else if (boxLength === 0) {
        return offset + headerLength <= buffer.length
      }
      if (boxSize < BigInt(headerLength) || boxSize > BigInt(Number.MAX_SAFE_INTEGER)) return false
      const boxEnd = offset + Number(boxSize)
      if (boxEnd > buffer.length) return false
      offset = boxEnd
    }
    return offset === buffer.length
  }

  return false
}

function safeImageError(error) {
  if (error instanceof ImageInputError) return error
  return new ImageInputError()
}

/** Decode an untrusted raster and return bounded, metadata-free WebP variants. */
export async function optimizeImage(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new ImageInputError()
  if (buffer.byteLength > IMAGE_MAX_BYTES) {
    throw new ImageInputError(IMAGE_TOO_LARGE_MESSAGE, 413)
  }

  let metadata
  try {
    metadata = await sharp(buffer, { failOn: 'warning' }).metadata()
  } catch (error) {
    throw safeImageError(error)
  }

  const format = getInputFormat(metadata)
  if (!ALLOWED_FORMATS.has(format) || !hasCompleteContainer(buffer, format)) {
    throw new ImageInputError()
  }

  if (Number.isInteger(metadata.pages) && metadata.pages > 1) {
    throw new ImageInputError()
  }

  if (
    !Number.isSafeInteger(metadata.width) || metadata.width <= 0 ||
    !Number.isSafeInteger(metadata.height) || metadata.height <= 0
  ) {
    throw new ImageInputError()
  }
  if (metadata.width * metadata.height > IMAGE_MAX_PIXELS) {
    throw new ImageInputError(IMAGE_TOO_LARGE_MESSAGE, 413)
  }

  const variants = []
  for (const [name, bound] of Object.entries(IMAGE_VARIANTS)) {
    try {
      const { data, info } = await sharp(buffer, {
        failOn: 'warning',
        limitInputPixels: IMAGE_MAX_PIXELS,
      })
        .rotate()
        .resize({
          width: bound,
          height: bound,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp(WEBP_OPTIONS)
        .timeout({ seconds: ENCODE_TIMEOUT_SECONDS })
        .toBuffer({ resolveWithObject: true })

      variants.push({ name, buffer: data, width: info.width, height: info.height })
    } catch (error) {
      throw safeImageError(error)
    }
  }

  return variants
}
