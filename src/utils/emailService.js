import { createSmtpTransporter, getSmtpConfiguration } from './smtpTransport.js'
import { buildPropertyUrl, escapeHtml, getTrustedFrontendOrigin } from './contactRules.js'
import { serializeProperty } from './propertyRules.js'
export { sendContactNotification } from './contactEmailService.js'

const createTransporter = () => createSmtpTransporter()

function safeImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

function formatAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—'
}

function monthlySuffix(property) {
  return property.listingPurpose === 'rent' ? ' / month' : ''
}

function formatBound(criteria, minimum, maximum, formatter = value => value) {
  const hasMinimum = Object.hasOwn(criteria, minimum)
  const hasMaximum = Object.hasOwn(criteria, maximum)
  if (!hasMinimum && !hasMaximum) return null
  return `${hasMinimum ? formatter(criteria[minimum]) : 'Any'} - ${hasMaximum ? formatter(criteria[maximum]) : 'Any'}`
}

function safeSubject(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 100)
  return `New Properties Match Your Search: ${name}`
}

function formatCriteriaHtml(criteria) {
  const rows = []
  const savedLocation = typeof criteria.location === 'string' ? criteria.location.trim() : ''
  if (savedLocation) rows.push(`<li>Location: ${escapeHtml(savedLocation)}</li>`)

  const structured = ['county', 'constituency', 'ward']
    .filter(field => typeof criteria[field] === 'string' && criteria[field].trim())
    .map(field => criteria[field].trim())
  if (structured.length) rows.push(`<li>Area: ${structured.map(escapeHtml).join(', ')}</li>`)

  if (criteria.listingPurpose) rows.push(`<li>Listing purpose: ${escapeHtml(criteria.listingPurpose)}</li>`)
  if (Array.isArray(criteria.propertyTypes) && criteria.propertyTypes.length) {
    rows.push(`<li>Property types: ${criteria.propertyTypes.map(escapeHtml).join(', ')}</li>`)
  }

  const priceRange = formatBound(criteria, 'minPrice', 'maxPrice', value => `KSh ${formatAmount(value)}`)
  const priceLabel = criteria.listingPurpose === 'rent' ? 'Effective monthly rent range' : 'Effective price range'
  if (priceRange !== null) rows.push(`<li>${priceLabel}: ${escapeHtml(priceRange)}${monthlySuffix(criteria)}</li>`)
  const bedroomRange = formatBound(criteria, 'minBedrooms', 'maxBedrooms')
  if (bedroomRange !== null) rows.push(`<li>Bedrooms: ${escapeHtml(bedroomRange)}</li>`)
  const bathroomRange = formatBound(criteria, 'minBathrooms', 'maxBathrooms')
  if (bathroomRange !== null) rows.push(`<li>Bathrooms: ${escapeHtml(bathroomRange)}</li>`)
  if (typeof criteria.searchTerm === 'string' && criteria.searchTerm.trim()) {
    rows.push(`<li>Search term: “${escapeHtml(criteria.searchTerm.trim())}”</li>`)
  }
  return rows.join('\n')
}

function propertyCard(propertyValue, frontendOrigin) {
  const property = serializeProperty(propertyValue) ?? {}
  const title = escapeHtml(property.title)
  const price = formatAmount(property.effectivePrice)
  const location = escapeHtml(property.location)
  const type = escapeHtml(property.type)
  const description = escapeHtml(property.description)
  const imageUrl = safeImageUrl(property.images?.[0])
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${title}">`
    : ''
  const propertyUrl = buildPropertyUrl(String(property._id ?? ''), frontendOrigin)
  const viewLink = propertyUrl
    ? `<a href="${escapeHtml(propertyUrl)}" class="btn">View Property</a>`
    : ''
  const bedrooms = typeof property.bedrooms === 'number' && property.bedrooms > 0
    ? `<p><strong>Bedrooms:</strong> ${escapeHtml(property.bedrooms)}</p>`
    : ''
  const bathrooms = typeof property.bathrooms === 'number' && property.bathrooms > 0
    ? `<p><strong>Bathrooms:</strong> ${escapeHtml(property.bathrooms)}</p>`
    : ''
  const offer = property.offerPercent > 0
    ? `<p><del>KSh ${escapeHtml(formatAmount(property.price))}</del>${monthlySuffix(property)} · ${escapeHtml(property.offerPercent)}% off</p>`
    : ''

  return `<div class="property">
    ${image}
    <h3>${title}</h3>
    <p class="price">KSh ${escapeHtml(price)}${monthlySuffix(property)}</p>
    ${offer}
    <p><strong>Type:</strong> ${type}</p>
    <p><strong>Location:</strong> ${location}</p>
    ${bedrooms}
    ${bathrooms}
    <p>${description}</p>
    ${viewLink}
  </div>`
}

// Send property alert email. Transport and trusted site origin are both required.
const sendPropertyAlert = async (savedSearch, matchingProperties) => {
  try {
    const smtp = getSmtpConfiguration()
    const sender = smtp?.from || process.env.EMAIL_FROM?.trim()
    const frontendOrigin = getTrustedFrontendOrigin()
    if (!smtp || !sender || !frontendOrigin) {
      return { success: false, error: 'notification_not_configured' }
    }

    const transporter = createTransporter()
    if (!transporter) return { success: false, error: 'notification_not_configured' }

    const criteria = typeof savedSearch.searchCriteria?.toObject === 'function'
      ? savedSearch.searchCriteria.toObject({ virtuals: false, transform: false })
      : savedSearch.searchCriteria ?? {}
    const properties = matchingProperties.map(property => serializeProperty(property) ?? {})
    const safeName = escapeHtml(savedSearch.name)
    const safeUserName = escapeHtml(savedSearch.userName)
    const criteriaHtml = formatCriteriaHtml(criteria)
    const propertyHtml = properties.map(property => propertyCard(property, frontendOrigin)).join('\n')
    const propertyText = properties.map(property => {
      const propertyUrl = buildPropertyUrl(String(property._id ?? ''), frontendOrigin)
      return [
        `- ${property.title ?? ''}`,
        `- KSh ${formatAmount(property.effectivePrice)}${monthlySuffix(property)}`,
        property.offerPercent > 0 ? `- Original KSh ${formatAmount(property.price)}${monthlySuffix(property)}; ${property.offerPercent}% off` : '',
        `- ${property.type ?? ''}`,
        `- ${property.location ?? ''}`,
        propertyUrl ? `- View: ${propertyUrl}` : '',
      ].filter(Boolean).join('\n')
    }).join('\n\n')
    const listingsUrl = `${frontendOrigin}/listings`
    const dashboardUrl = `${frontendOrigin}/dashboard`

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Property Alert</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .property { border: 1px solid #ddd; margin: 15px 0; padding: 15px; border-radius: 8px; }
    .property img { width: 100%; max-width: 300px; height: 200px; object-fit: cover; border-radius: 4px; }
    .property h3 { color: #2563eb; margin: 10px 0; }
    .property p { margin: 5px 0; }
    .price { font-size: 1.2em; font-weight: bold; color: #059669; }
    .footer { background: #f3f4f6; padding: 20px; text-align: center; font-size: 0.9em; }
    .btn { display: inline-block; background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>🏠 New Properties Match Your Search!</h1></div>
    <div class="content">
      <p>Hello ${safeUserName},</p>
      <p>We found <strong>${properties.length}</strong> new properties that match your saved search: <strong>“${safeName}”</strong></p>
      <h2>Your Search Criteria:</h2>
      <ul>${criteriaHtml}</ul>
      <h2>New Matching Properties:</h2>
      ${propertyHtml}
      <div style="text-align: center; margin: 30px 0;">
        <a href="${escapeHtml(listingsUrl)}" class="btn">View All Properties</a>
      </div>
    </div>
    <div class="footer">
      <p>This alert was sent because you have an active saved search. You can manage your saved searches in your <a href="${escapeHtml(dashboardUrl)}">dashboard</a>.</p>
      <p>If you no longer wish to receive these alerts, you can disable them in your dashboard.</p>
      <p>© 2024 Zawamu Properties. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`

    const textContent = `New Properties Match Your Search: ${String(savedSearch.name ?? '')}

Hello ${String(savedSearch.userName ?? '')},

We found ${properties.length} new properties that match your saved search.

Matching Properties:
${propertyText}

View all properties: ${listingsUrl}
Manage your searches: ${dashboardUrl}`

    const result = await transporter.sendMail({
      from: sender,
      to: savedSearch.userEmail,
      subject: safeSubject(savedSearch.name),
      text: textContent,
      html: htmlContent,
    })
    return { success: true, messageId: result.messageId }
  } catch {
    return { success: false, error: 'delivery_uncertain' }
  }
}

// Send multiple alerts
const sendPropertyAlerts = async matches => {
  const results = []

  for (const match of matches) {
    const { savedSearch, matchingProperties } = match
    const maxAlerts = savedSearch.alertSettings?.maxAlertsPerDay ?? 5
    const sentToday = Number.isFinite(savedSearch.alertsSentToday) ? savedSearch.alertsSentToday : 0

    if (sentToday >= maxAlerts) continue

    try {
      const result = await sendPropertyAlert(savedSearch, matchingProperties)

      if (result.success) {
        savedSearch.lastAlertSent = new Date()
        savedSearch.totalAlertsSent = (Number.isFinite(savedSearch.totalAlertsSent) ? savedSearch.totalAlertsSent : 0) + 1
        savedSearch.alertsSentToday = sentToday + 1
        await savedSearch.save()

        results.push({
          savedSearchId: savedSearch._id,
          userEmail: savedSearch.userEmail,
          success: true,
          messageId: result.messageId,
          propertiesCount: matchingProperties.length,
        })
      } else {
        results.push({
          savedSearchId: savedSearch._id,
          userEmail: savedSearch.userEmail,
          success: false,
          error: result.error,
        })
      }
    } catch {
      results.push({
        savedSearchId: savedSearch._id,
        userEmail: savedSearch.userEmail,
        success: false,
        error: 'delivery_uncertain',
      })
    }
  }

  return results
}

export { sendPropertyAlert, sendPropertyAlerts }
