import { createHash, randomBytes } from 'node:crypto'
import SavedSearchAccessLink from '../models/SavedSearchAccessLink.js'
import SavedSearchSession from '../models/SavedSearchSession.js'
import { createSmtpTransporter, getSmtpConfiguration } from './smtpTransport.js'
import { escapeHtml, getTrustedFrontendOrigin } from './contactRules.js'

const LINK_LIFETIME_MS = 30 * 60 * 1000
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

function digestToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function newToken() {
  return randomBytes(32).toString('base64url')
}

export function isSavedSearchToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

/** Send a single-use management link without returning or persisting its raw token. */
export async function requestSavedSearchManagementLink(email, now = new Date()) {
  const smtp = getSmtpConfiguration()
  const sender = smtp?.from || process.env.EMAIL_FROM?.trim()
  const origin = getTrustedFrontendOrigin()
  if (!smtp || !sender || !origin) return false

  const transporter = createSmtpTransporter()
  if (!transporter) return false

  const rawToken = newToken()
  const tokenHash = digestToken(rawToken)
  const expiresAt = new Date(now.getTime() + LINK_LIFETIME_MS)
  const manageUrl = `${origin}/dashboard#saved-search-token=${rawToken}`
  await SavedSearchAccessLink.create({ tokenHash, email, expiresAt })

  try {
    await transporter.sendMail({
      from: sender,
      to: email,
      subject: 'Your Zawamu saved-search access link',
      text: `Use this one-time link to manage your saved searches: ${manageUrl}\n\nIt expires in 30 minutes. If you did not request it, you can ignore this email.`,
      html: `<p>Use this one-time link to manage your saved searches:</p><p><a href="${escapeHtml(manageUrl)}">Manage saved searches</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`,
    })
    return true
  } catch {
    // A failed send must not leave a usable bearer link behind.
    try {
      await SavedSearchAccessLink.updateOne(
        { tokenHash, consumedAt: null, revokedAt: null },
        { $set: { revokedAt: now } },
      )
    } catch {
      // Keep transport and storage details out of public responses and logs.
    }
    return false
  }
}

/** Atomically consume the link, then issue a separate digest-backed session. */
export async function consumeSavedSearchManagementLink(rawToken, now = new Date()) {
  if (!isSavedSearchToken(rawToken)) return null
  const tokenHash = digestToken(rawToken)
  const link = await SavedSearchAccessLink.findOneAndUpdate(
    {
      tokenHash,
      consumedAt: null,
      revokedAt: null,
      expiresAt: { $gt: now },
    },
    { $set: { consumedAt: now } },
    { new: true },
  )
  if (!link || typeof link.email !== 'string') return null

  const email = link.email.trim().toLowerCase()
  if (!email) return null
  const sessionToken = newToken()
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS)
  await SavedSearchSession.create({
    tokenHash: digestToken(sessionToken),
    email,
    expiresAt,
  })
  return { token: sessionToken, email, expiresAt }
}

/** Resolve only a live, unrevoked management session; never return its digest. */
export async function resolveSavedSearchSession(rawToken, now = new Date()) {
  if (!isSavedSearchToken(rawToken)) return null
  const session = await SavedSearchSession.findOne({
    tokenHash: digestToken(rawToken),
    revokedAt: null,
    expiresAt: { $gt: now },
  })
  if (!session || session.revokedAt || !(session.expiresAt instanceof Date) || session.expiresAt <= now) return null
  if (typeof session.email !== 'string' || !session.email.trim()) return null
  return { email: session.email.trim().toLowerCase(), expiresAt: session.expiresAt }
}

export async function revokeSavedSearchSession(rawToken, now = new Date()) {
  if (!isSavedSearchToken(rawToken)) return false
  const result = await SavedSearchSession.updateOne(
    { tokenHash: digestToken(rawToken), revokedAt: null },
    { $set: { revokedAt: now } },
  )
  return Boolean(result?.modifiedCount)
}
