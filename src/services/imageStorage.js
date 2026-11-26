import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { optimizeImage, ImageInputError } from '../utils/imageOptimizer.js'

const REQUEST_TIMEOUT_MS = 15_000

export function getR2Configuration(env = process.env) {
  if (!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID ?? '') ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET_NAME ?? '') ||
      ![env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY].every(value => typeof value === 'string' && value.trim() && value === value.trim())) return null
  try {
    const raw = env.R2_PUBLIC_URL
    if (typeof raw !== 'string' || raw !== raw.trim() || !/^https:\/\//.test(raw) || /[\\?#\s]/.test(raw)) return null
    const url = new URL(raw)
    // Public delivery uses a custom domain (or development r2.dev), never the
    // authenticated S3 API. Restrict prefixes so URL normalization cannot hide traversal.
    const path = raw.slice(raw.indexOf('/', 8))
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.hostname.endsWith('.r2.cloudflarestorage.com') ||
        (raw.indexOf('/', 8) !== -1 && !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(path))) return null
    return {
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucket: env.R2_BUCKET_NAME,
      publicUrl: url.href.replace(/\/$/, ''),
      objectPrefix: url.pathname.replace(/^\/+|\/+$/g, ''),
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    }
  } catch {
    return null
  }
}

export class ImageStorageError extends Error {
  constructor(cleanupIncomplete = false) {
    super('Image storage is temporarily unavailable')
    this.status = 503
    this.cleanupIncomplete = cleanupIncomplete
  }
}

// Injection is for deterministic tests; production always uses the account-derived
// endpoint and explicit static credentials, never ambient AWS credential discovery.
export function createImageStorage({ env = process.env, client } = {}) {
  return {
    async uploadImages(files) {
      const config = getR2Configuration(env)
      if (!config) throw new ImageStorageError()
      const ownedClient = !client
      const transport = client ?? new S3Client({
        region: 'auto', endpoint: config.endpoint, credentials: config.credentials,
        maxAttempts: 2,
        requestHandler: { connectionTimeout: 3_000, requestTimeout: REQUEST_TIMEOUT_MS },
      })
      const attemptedKeys = []
      const send = command => transport.send(command, { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      try {
        const urls = []
        for (const file of files) {
          const variants = await optimizeImage(file.buffer)
          const prefix = `images/v1/${randomUUID()}`
          for (const variant of variants) {
            const Key = `${config.objectPrefix ? `${config.objectPrefix}/` : ''}${prefix}/${variant.name}.webp`
            // Include uncertain failed PUTs in compensation; never delete keys
            // from input URLs, previous batches or saved catalogue records.
            attemptedKeys.push(Key)
            await send(new PutObjectCommand({
              Bucket: config.bucket, Key, Body: variant.buffer,
              ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable',
            }))
          }
          urls.push(`${config.publicUrl}/${prefix}/large.webp`)
        }
        return { urls }
      } catch (error) {
        let cleanupIncomplete = false
        for (const Key of attemptedKeys) {
          try { await send(new DeleteObjectCommand({ Bucket: config.bucket, Key })) }
          catch { cleanupIncomplete = true }
        }
        if (error instanceof ImageInputError && !cleanupIncomplete) throw error
        throw new ImageStorageError(cleanupIncomplete)
      } finally {
        if (ownedClient) transport.destroy()
      }
    },
  }
}
