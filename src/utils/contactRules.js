export const CONTACT_FIELDS = Object.freeze([
  'name', 'email', 'message', 'phone', 'subject', 'interest', 'source', 'propertyId',
])

export const CONTACT_LIMITS = Object.freeze({
  name: 120,
  email: 254,
  message: 5000,
  phone: 40,
  subject: 160,
  interest: 100,
})

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

export function parseContactSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('invalid_body')
  if (Object.keys(body).some(key => !CONTACT_FIELDS.includes(key))) throw new TypeError('unknown_field')

  const source = body.source === undefined ? 'general' : body.source
  if (source !== 'general' && source !== 'property') throw new TypeError('invalid_source')

  const result = {}
  for (const field of ['name', 'email', 'message']) {
    if (typeof body[field] !== 'string') throw new TypeError('invalid_required_field')
    const value = (field === 'message' ? body[field].replace(/\r\n?/g, '\n') : body[field]).trim()
    const invalidControls = field === 'message'
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
      : /[\u0000-\u001f\u007f]/
    if (!value || value.length > CONTACT_LIMITS[field] || invalidControls.test(value)) {
      throw new TypeError('invalid_required_field')
    }
    result[field] = field === 'email' ? value.toLowerCase() : value
  }
  if (result.email.length > CONTACT_LIMITS.email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result.email)) {
    throw new TypeError('invalid_email')
  }
  if (result.message.length > CONTACT_LIMITS.message) throw new TypeError('invalid_message')
  if (result.name.length > CONTACT_LIMITS.name) throw new TypeError('invalid_name')

  for (const field of ['phone', 'subject', 'interest']) {
    if (body[field] === undefined || body[field] === null || body[field] === '') continue
    if (typeof body[field] !== 'string') throw new TypeError('invalid_optional_field')
    const value = body[field].trim()
    if (!value) continue
    if (value.length > CONTACT_LIMITS[field] || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('invalid_optional_field')
    result[field] = value
  }

  result.source = source
  if (source === 'property') {
    if (typeof body.propertyId !== 'string' || !/^[a-f\d]{24}$/i.test(body.propertyId)) {
      throw new TypeError('invalid_property_id')
    }
    result.propertyId = body.propertyId.toLowerCase()
  } else if (body.propertyId !== undefined && body.propertyId !== null) {
    throw new TypeError('unexpected_property_id')
  }

  return result
}

export function getTrustedFrontendOrigin(value = process.env.FRONTEND_URL) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !isLocalHttp) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export function buildPropertyUrl(propertyId, frontendUrl = process.env.FRONTEND_URL) {
  const origin = getTrustedFrontendOrigin(frontendUrl)
  if (!origin || typeof propertyId !== 'string' || !/^[a-f\d]{24}$/i.test(propertyId)) return null
  return `${origin}/listings/${propertyId.toLowerCase()}`
}

export function toContactDto(contact) {
  const source = contact.source === 'property' ? 'property' : 'general'
  const status = ['new', 'read', 'resolved'].includes(contact.status) ? contact.status : 'new'
  const rawNotification = contact.notification ?? {}
  const notificationStatus = ['pending', 'sending', 'sent', 'failed'].includes(rawNotification.status)
    ? rawNotification.status
    : 'pending'
  const safeErrors = new Set(['notification_not_configured', 'delivery_failed', 'delivery_uncertain'])
  const lastError = safeErrors.has(rawNotification.lastError) ? rawNotification.lastError : null

  return {
    _id: String(contact._id),
    name: contact.name,
    email: contact.email,
    message: contact.message,
    phone: contact.phone ?? null,
    subject: contact.subject ?? null,
    interest: contact.interest ?? null,
    source,
    propertyId: contact.propertyId == null ? null : String(contact.propertyId),
    propertyTitle: contact.propertyTitle ?? null,
    propertyUrl: contact.propertyUrl ?? null,
    status,
    notification: {
      status: notificationStatus,
      attempts: Number.isInteger(rawNotification.attempts) && rawNotification.attempts >= 0 ? rawNotification.attempts : 0,
      lastAttemptAt: rawNotification.lastAttemptAt ?? null,
      lastError,
    },
    createdAt: contact.createdAt ?? null,
  }
}
