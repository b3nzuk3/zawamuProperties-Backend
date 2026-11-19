import { createSmtpTransporter, getSmtpConfiguration } from './smtpTransport.js'
import { escapeHtml, buildPropertyUrl } from './contactRules.js'

const MAX_NOTIFICATION_TEXT = 6000

function plainText(contact) {
  const lines = [
    `Name: ${contact.name}`,
    `Email: ${contact.email}`,
    contact.phone ? `Phone: ${contact.phone}` : null,
    contact.subject ? `Subject: ${contact.subject}` : null,
    contact.interest ? `Interest: ${contact.interest}` : null,
    `Source: ${contact.source === 'property' ? 'Property enquiry' : 'General enquiry'}`,
    contact.propertyTitle ? `Property: ${contact.propertyTitle}` : null,
    contact.propertyUrl ? `Listing: ${contact.propertyUrl}` : null,
    '',
    'Message:',
    String(contact.message ?? '').slice(0, MAX_NOTIFICATION_TEXT),
  ]
  return lines.filter(line => line !== null).join('\n')
}

function htmlContent(contact) {
  const source = contact.source === 'property' ? 'Property enquiry' : 'General enquiry'
  const details = [
    ['Name', contact.name],
    ['Email', contact.email],
    ['Phone', contact.phone],
    ['Subject', contact.subject],
    ['Interest', contact.interest],
    ['Property', contact.propertyTitle],
  ].filter(([, value]) => value)
    .map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`)
    .join('')
  const listing = contact.propertyUrl && contact.propertyTitle
    ? `<p><a href="${escapeHtml(contact.propertyUrl)}">View listing: ${escapeHtml(contact.propertyTitle)}</a></p>`
    : ''
  return `<!doctype html><html><body><h1>${escapeHtml(source)}</h1>${details}<p><strong>Message:</strong></p><p style="white-space:pre-wrap">${escapeHtml(String(contact.message ?? '').slice(0, MAX_NOTIFICATION_TEXT))}</p>${listing}</body></html>`
}

function notificationContact(contact) {
  if (contact.source !== 'property') return contact
  const values = typeof contact.toObject === 'function' ? contact.toObject() : contact
  return {
    ...values,
    propertyUrl: buildPropertyUrl(String(contact.propertyId ?? ''), process.env.FRONTEND_URL),
  }
}

export async function sendContactNotification(contact) {
  const emailContact = notificationContact(contact)
  const smtp = getSmtpConfiguration()
  const recipient = process.env.CONTACT_NOTIFICATION_EMAIL?.trim()
  const from = smtp?.from
  const propertyUrlIsTrusted = emailContact.source !== 'property' || Boolean(emailContact.propertyUrl)
  if (!smtp || !from || !recipient || !propertyUrlIsTrusted || !emailContact.email) {
    return { success: false, errorCode: 'notification_not_configured' }
  }

  try {
    const transporter = createSmtpTransporter()
    if (!transporter) return { success: false, errorCode: 'notification_not_configured' }
    const result = await transporter.sendMail({
      from,
      to: recipient,
      replyTo: emailContact.email,
      subject: emailContact.source === 'property' ? 'New property enquiry' : 'New general enquiry',
      text: plainText(emailContact),
      html: htmlContent(emailContact),
    })
    return { success: true, messageId: result.messageId ?? null }
  } catch {
    // SMTP exceptions can contain credentials, message bodies, or provider diagnostics.
    return { success: false, errorCode: 'delivery_uncertain' }
  }
}
