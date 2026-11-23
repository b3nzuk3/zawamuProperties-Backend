import { isSavedSearchToken, resolveSavedSearchSession } from '../utils/savedSearchAccessService.js'

const WINDOW_MS = 15 * 60 * 1000
const MAX_KEYS = 4096
const ipBuckets = new Map()
const emailBuckets = new Map()
let sweepCounter = 0

function normalizedEmail(value) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null
}

function hitBucket(store, key, limit, now) {
  sweepCounter += 1
  if (sweepCounter % 128 === 0 || store.size >= MAX_KEYS) {
    for (const [existingKey, bucket] of store) {
      if (bucket.resetAt <= now) store.delete(existingKey)
    }
  }

  let bucket = store.get(key)
  if (!bucket || bucket.resetAt <= now) {
    if (store.size >= MAX_KEYS) store.delete(store.keys().next().value)
    bucket = { count: 0, resetAt: now + WINDOW_MS }
  }
  if (bucket.count >= limit) {
    store.delete(key)
    store.set(key, bucket)
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  }
  bucket.count += 1
  store.delete(key)
  store.set(key, bucket)
  return 0
}

function requestIp(req) {
  const value = typeof req.ip === 'string' && req.ip ? req.ip : req.socket?.remoteAddress
  return typeof value === 'string' ? value.slice(0, 128) : 'unknown'
}

function rejectRateLimit(res, retryAfterSeconds) {
  res.set('Retry-After', String(retryAfterSeconds))
  return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' })
}

function applyIpLimit(req, res) {
  const retryAfter = hitBucket(ipBuckets, requestIp(req), 30, Date.now())
  if (retryAfter) rejectRateLimit(res, retryAfter)
  return retryAfter === 0
}

export function savedSearchAccessRequestRateLimit(req, res, next) {
  if (!applyIpLimit(req, res)) return
  const email = normalizedEmail(req.body?.email ?? req.body?.userEmail)
  if (email) {
    const retryAfter = hitBucket(emailBuckets, email, 5, Date.now())
    if (retryAfter) return rejectRateLimit(res, retryAfter)
  }
  next()
}

export function savedSearchAccessConsumeRateLimit(req, res, next) {
  if (!applyIpLimit(req, res)) return
  next()
}

export function optionalSavedSearchSession(req, res, next) {
  const rawToken = req.get('X-Saved-Search-Session')
  if (!rawToken) {
    req.savedSearchScope = null
    return next()
  }
  return loadSession(rawToken, req, res, next)
}

export function requireSavedSearchSession(req, res, next) {
  const rawToken = req.get('X-Saved-Search-Session')
  if (!rawToken) return res.status(401).json({ success: false, message: 'Saved-search access required' })
  return loadSession(rawToken, req, res, next)
}

async function loadSession(rawToken, req, res, next) {
  if (!isSavedSearchToken(rawToken)) {
    return res.status(401).json({ success: false, message: 'Saved-search access required' })
  }
  try {
    const session = await resolveSavedSearchSession(rawToken)
    if (!session) return res.status(401).json({ success: false, message: 'Saved-search access required' })
    req.savedSearchScope = { email: session.email }
    return next()
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to verify saved-search access' })
  }
}
