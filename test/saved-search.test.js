import test from 'node:test'
import assert from 'node:assert/strict'
import nodemailer from 'nodemailer'
import app from '../src/app.js'
import Property from '../src/models/Property.js'
import SavedSearch from '../src/models/SavedSearch.js'
import SavedSearchSession from '../src/models/SavedSearchSession.js'
import { checkForNewMatches } from '../src/controllers/savedSearchController.js'
import { sendPropertyAlert } from '../src/utils/emailService.js'
import { validateSavedSearchCriteria } from '../src/utils/savedSearchRules.js'
import { query, serve, stub } from './helpers/http.js'

const mailEnv = [
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD',
  'SMTP_FROM', 'FRONTEND_URL', 'EMAIL_FROM', 'SAVED_SEARCH_ALERTS_ENABLED',
]

function preserveEnv(t) {
  const previous = Object.fromEntries(mailEnv.map(key => [key, process.env[key]]))
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

function configureMail() {
  process.env.SMTP_HOST = 'smtp.example.test'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_SECURE = 'false'
  delete process.env.SMTP_USER
  delete process.env.SMTP_PASSWORD
  process.env.SMTP_FROM = 'Zawamu <alerts@example.test>'
  process.env.FRONTEND_URL = 'https://www.zawamu.test'
}

function property(id, fields = {}) {
  return Property.hydrate({
    _id: id.toString(16).padStart(24, '0'),
    title: 'Eastlands apartment',
    description: 'Two-bedroom home',
    price: 100_000,
    type: 'Apartment',
    location: 'Eastlands',
    county: 'Nairobi',
    constituency: 'Embakasi',
    ward: 'Umoja',
    listingPurpose: 'sale',
    availability: 'available',
    offerPercent: 0,
    bedrooms: 2,
    bathrooms: 1,
    ...fields,
  })
}

function savedSearch(searchCriteria, fields = {}) {
  return SavedSearch.hydrate({
    _id: '64b000000000000000000001',
    userEmail: 'visitor@example.test',
    userName: 'Visitor',
    name: 'Eastlands homes',
    searchCriteria,
    alertSettings: { isActive: true, frequency: 'daily', maxAlertsPerDay: 5 },
    alertsSentToday: 0,
    lastAlertResetDate: new Date(),
    ...fields,
  })
}

function fakeResponse() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

function verifiedSession(t) {
  const token = 'A'.repeat(43)
  stub(t, SavedSearchSession, 'findOne', async () => ({
    email: 'visitor@example.test',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
  }))
  return token
}

function privateRequest(api, token, method, path, body = {}) {
  return api.request(method, path, undefined, body, 'application/json', { 'X-Saved-Search-Session': token })
}

function propertyCursor(rows) {
  return {
    sort() { return this },
    cursor() {
      return {
        async *[Symbol.asyncIterator]() { yield* rows },
        async close() {},
      }
    },
  }
}

test('model matching applies read-time property defaults, effective price, zero bounds, and required location constraints', () => {
  const search = savedSearch({
    location: 'Umoja',
    county: 'nairobi',
    constituency: 'EMBAKASI',
    ward: 'Umoja',
    listingPurpose: 'sale',
    propertyTypes: ['apartment'],
    minPrice: 80_000,
    maxPrice: 80_000,
    minBedrooms: 0,
    maxBedrooms: 2,
    minBathrooms: 0,
    maxBathrooms: 1,
  })
  const legacySale = property(2, {
    listingPurpose: undefined,
    offerPercent: 20,
    location: '',
    bedrooms: 0,
    bathrooms: 0,
  })
  const searchBefore = search.toObject({ virtuals: false, transform: false })
  const propertyBefore = legacySale.toObject({ virtuals: false, transform: false })

  assert.equal(search.matchesProperty(legacySale), true)
  assert.deepEqual(search.toObject({ virtuals: false, transform: false }), searchBefore)
  assert.deepEqual(legacySale.toObject({ virtuals: false, transform: false }), propertyBefore)
  assert.equal(search.matchesProperty(property(3, { county: undefined })), false)
  assert.equal(search.matchesProperty(property(4, { constituency: undefined })), false)
  assert.equal(search.matchesProperty(property(5, { ward: undefined })), false)
  assert.equal(search.matchesProperty(property(6, { type: 'Bungalow' })), false)
})

test('zero-valued bounds remain active and fail when bounded property data is missing', () => {
  const search = savedSearch({ minPrice: 0, minBedrooms: 0, minBathrooms: 0 })
  const incomplete = { title: 'Legacy', price: 10, type: 'Apartment', location: 'Nairobi' }
  const complete = { ...incomplete, bedrooms: 0, bathrooms: 0 }
  assert.equal(search.matchesProperty(incomplete), false)
  assert.equal(search.matchesProperty(complete), true)
})

test('hydrated missing room counts do not become stored zero counts for bounded searches', async t => {
  const raw = { _id: '64b000000000000000000040', title: 'Legacy', price: 100, type: 'Land', location: 'Nairobi' }
  const missing = Property.hydrate(raw)
  const explicitZero = Property.hydrate({ ...raw, _id: '64b000000000000000000041', bedrooms: 0, bathrooms: 0 })
  assert.equal(missing.bedrooms, 0)
  for (const criteria of [{ maxBedrooms: 2 }, { maxBathrooms: 1 }, { minBedrooms: 0 }, { minBathrooms: 0 }]) {
    const search = savedSearch(criteria)
    assert.equal(search.matchesProperty(missing), false)
    assert.equal(search.matchesProperty(explicitZero), true)
  }
  const search = savedSearch({ maxBedrooms: 2, maxBathrooms: 1 })
  stub(t, SavedSearch, 'findOne', async () => search)
  stub(t, Property, 'find', () => propertyCursor([missing, explicitZero]))
  const token = verifiedSession(t)
  const api = await serve(app)
  t.after(() => api.close())
  const response = await privateRequest(api, token, 'GET', '/api/saved-searches/64b000000000000000000001/properties')
  assert.equal(response.status, 200)
  assert.deepEqual(response.data.data.properties.map(row => row._id), [String(explicitZero._id)])
})

test('historic type aliases map exactly; ambiguous house and commercial values stay literal', () => {
  const cases = [
    ['apartment', 'Apartment', true],
    ['Apartment', 'apartment', true],
    ['land', 'Land', true],
    ['office', 'Office space', true],
    ['office', 'office', true],
    ['house', 'Bungalow', false],
    ['house', 'house', true],
    ['commercial', 'Office space', false],
    ['commercial', 'commercial', true],
  ]
  for (const [criterion, actual, expected] of cases) {
    assert.equal(
      savedSearch({ propertyTypes: [criterion] }).matchesProperty(property(7, { type: actual })),
      expected,
      `${criterion} against ${actual}`,
    )
  }
})

test('legacy county all means no county constraint but never erases a retained ward or constituency', () => {
  const listing = property(40, { county: undefined, ward: 'Umoja' })
  assert.equal(savedSearch({ county: 'all' }).matchesProperty(listing), true)
  assert.equal(savedSearch({ county: 'all', ward: 'Umoja' }).matchesProperty(listing), true)
  assert.equal(savedSearch({ county: 'all', ward: 'Missing' }).matchesProperty(listing), false)
  assert.equal(savedSearch({ county: 'all', constituency: 'Missing' }).matchesProperty(listing), false)
})

test('criteria validation accepts the title-case taxonomy and exact legacy spellings only', async () => {
  const criteria = validateSavedSearchCriteria({
    location: '  Westlands  ',
    listingPurpose: 'rent',
    propertyTypes: ['Apartment', 'Bungalow', 'Townhouse', 'Land', 'Maisonette', 'Office space', 'apartment', 'land', 'office', 'house', 'commercial'],
    minPrice: 0,
    maxPrice: 0,
    minBedrooms: 0,
    maxBedrooms: 4,
  })
  assert.equal(criteria.location, 'Westlands')
  assert.equal(criteria.minPrice, 0)
  assert.equal(criteria.maxPrice, 0)
  assert.throws(() => validateSavedSearchCriteria({ propertyTypes: ['townhouse'] }), /unsupported property type/)
  assert.throws(() => validateSavedSearchCriteria({ listingPurpose: 'lease' }), /listingPurpose/)
  assert.throws(() => validateSavedSearchCriteria({ minPrice: Number.POSITIVE_INFINITY }), /finite/)
  assert.throws(() => validateSavedSearchCriteria({ minBedrooms: -1 }), /non-negative/)
  assert.throws(() => validateSavedSearchCriteria({ minBathrooms: 2, maxBathrooms: 1 }), /cannot exceed/)
  assert.throws(() => validateSavedSearchCriteria({ unexpected: 'value' }), /unsupported search criteria/)
  const search = new SavedSearch({
    userEmail: 'visitor@example.test',
    userName: 'Visitor',
    name: 'Schema fixture',
    searchCriteria: criteria,
  })
  await search.validate()
})

test('search terms are literal strings rather than user-controlled regular expressions', () => {
  const regexLooking = savedSearch({ searchTerm: '.*' })
  assert.equal(regexLooking.matchesProperty(property(8, { title: 'A nice home' })), false)
  assert.equal(regexLooking.matchesProperty(property(9, { title: '.*' })), true)
})

test('HTTP matching uses the same predicate and does not query a nonexistent isActive property', async t => {
  const search = savedSearch({
    location: 'Eastlands',
    county: 'Nairobi',
    constituency: 'Embakasi',
    ward: 'Umoja',
    propertyTypes: ['Apartment'],
    minPrice: 80_000,
    maxPrice: 80_000,
  })
  const candidates = [
    property(10, { offerPercent: 20 }),
    property(11, { offerPercent: 20, availability: 'sold' }),
    property(12, { offerPercent: 20, county: undefined }),
    property(13, { offerPercent: 20, ward: 'Kayole' }),
  ]
  let propertyFilter
  stub(t, SavedSearch, 'findOne', async () => search)
  stub(t, Property, 'find', filter => {
    propertyFilter = filter
    return propertyCursor(candidates)
  })
  const token = verifiedSession(t)
  const api = await serve(app)
  t.after(() => api.close())

  const response = await privateRequest(api, token, 'GET', '/api/saved-searches/64b000000000000000000001/properties?page=1&limit=10')
  assert.equal(response.status, 200)
  assert.deepEqual(propertyFilter, {})
  const expected = candidates.filter(candidate => search.matchesProperty(candidate)).map(candidate => String(candidate._id))
  const actual = response.data.data.properties.map(candidate => String(candidate._id))
  assert.deepEqual(actual, expected)
  assert.deepEqual(actual, [String(candidates[0]._id), String(candidates[1]._id)])
  assert.equal(response.data.data.properties[0].effectivePrice, 80_000)
  assert.equal(response.data.data.pagination.totalProperties, expected.length)
})

test('saved-search create and update reject unsafe criteria before querying storage', async t => {
  let lookups = 0
  let updates = 0
  stub(t, SavedSearch, 'findOne', async () => { lookups += 1; return null })
  stub(t, SavedSearch, 'findByIdAndUpdate', async () => { updates += 1; return null })
  const token = verifiedSession(t)
  const api = await serve(app)
  t.after(() => api.close())

  const base = {
    userEmail: 'visitor@example.test', userName: 'Visitor', name: 'Search',
    searchCriteria: {},
  }
  const unknown = await api.request('POST', '/api/saved-searches', undefined, {
    ...base,
    searchCriteria: { $where: 'return true' },
  })
  const operatorValue = await api.request('POST', '/api/saved-searches', undefined, {
    ...base,
    searchCriteria: { county: { $regex: '.*' } },
  })
  const reversedRange = await api.request('POST', '/api/saved-searches', undefined, {
    ...base,
    searchCriteria: { minPrice: 20, maxPrice: 10 },
  })
  const nonFinite = await api.request('POST', '/api/saved-searches', undefined, {
    ...base,
    searchCriteria: { minBedrooms: null },
  })
  const badUpdate = await privateRequest(api, token, 'PUT', '/api/saved-searches/64b000000000000000000001', {
    searchCriteria: { listingPurpose: 'lease' },
  })

  assert.equal(unknown.status, 400)
  assert.equal(operatorValue.status, 400)
  assert.equal(reversedRange.status, 400)
  assert.equal(nonFinite.status, 400)
  assert.equal(badUpdate.status, 400)
  assert.equal(lookups, 0)
  assert.equal(updates, 0)
})

test('owner alert execution uses the durable runner and returns only its safe summary', async t => {
  preserveEnv(t)
  process.env.SAVED_SEARCH_ALERTS_ENABLED = 'false'
  let searchReads = 0
  let propertyReads = 0
  stub(t, SavedSearch, 'find', async () => { searchReads += 1; return [] })
  stub(t, Property, 'find', () => { propertyReads += 1; return query([]) })
  const response = fakeResponse()
  await checkForNewMatches({}, response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.success, true)
  assert.equal(response.body.data.disabled, true)
  assert.equal(response.body.data.dryRun, true)
  assert.equal(searchReads, 0)
  assert.equal(propertyReads, 0)
})

test('saved-search alert HTML escapes dynamic text and uses only trusted frontend-origin links', async t => {
  preserveEnv(t)
  configureMail()
  let mail
  stub(t, nodemailer, 'createTransport', () => ({
    sendMail: async options => { mail = options; return { messageId: 'fixture-alert' } },
  }))

  const search = savedSearch({
    location: '<svg onload=alert(1)>',
    county: 'Nairobi & <script>alert(1)</script>',
    propertyTypes: ['Apartment'],
    searchTerm: '" <img src=x onerror=alert(1)>',
  }, {
    name: 'Homes <script>alert(2)</script>',
    userName: '<img src=x onerror=alert(3)>',
  })
  const listing = property(30, {
    title: '<svg onload=alert(4)>Title</svg>',
    description: '<img src=x onerror=alert(5)>',
    location: 'Location & <b>unsafe</b>',
    price: 100_000,
    offerPercent: 20,
    images: ['https://cdn.example.test/a.jpg?x=1&y=2'],
  })
  const unsafeImageListing = property(32, { images: ['javascript:alert(6)'] })
  const searchBefore = search.toObject({ virtuals: false, transform: false })
  const listingBefore = listing.toObject({ virtuals: false, transform: false })
  const unsafeImageBefore = unsafeImageListing.toObject({ virtuals: false, transform: false })

  const result = await sendPropertyAlert(search, [listing, unsafeImageListing])

  assert.deepEqual(search.toObject({ virtuals: false, transform: false }), searchBefore)
  assert.deepEqual(listing.toObject({ virtuals: false, transform: false }), listingBefore)
  assert.deepEqual(unsafeImageListing.toObject({ virtuals: false, transform: false }), unsafeImageBefore)
  assert.deepEqual(result, { success: true, messageId: 'fixture-alert' })
  assert.match(mail.html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/)
  assert.match(mail.html, /&lt;img src=x onerror=alert\(3\)&gt;/)
  assert.match(mail.html, /&lt;svg onload=alert\(4\)&gt;Title&lt;\/svg&gt;/)
  assert.match(mail.html, /src="https:\/\/cdn\.example\.test\/a\.jpg\?x=1&amp;y=2" alt="&lt;svg onload=alert\(4\)&gt;Title&lt;\/svg&gt;"/)
  assert.match(mail.html, /&lt;img src=x onerror=alert\(5\)&gt;/)
  assert.match(mail.html, /Nairobi &amp; &lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(mail.html, /&lt;svg onload=alert\(1\)&gt;/)
  assert.match(mail.html, /KSh 80,000/)
  assert.doesNotMatch(mail.html, /<script>|<svg|<img src=x|javascript:/)
  assert.match(mail.html, /href="https:\/\/www\.zawamu\.test\/listings\/00000000000000000000001e"/)
  assert.match(mail.html, /href="https:\/\/www\.zawamu\.test\/dashboard"/)
  assert.doesNotMatch(mail.html, /href="(?:http:\/\/localhost|javascript:|https:\/\/evil)/)
})

test('saved-search alerts do not send without a valid trusted frontend origin', async t => {
  preserveEnv(t)
  configureMail()
  process.env.FRONTEND_URL = 'http://untrusted.example.test'
  let transports = 0
  stub(t, nodemailer, 'createTransport', () => { transports += 1; return { sendMail: async () => ({ messageId: 'unexpected' }) } })

  const result = await sendPropertyAlert(savedSearch({}), [property(31)])

  assert.deepEqual(result, { success: false, error: 'notification_not_configured' })
  assert.equal(transports, 0)
})

test('rental alert HTML and text show discounted cents, original amount, offer and monthly units', async t => {
  preserveEnv(t)
  configureMail()
  let mail
  stub(t, nodemailer, 'createTransport', () => ({
    sendMail: async options => { mail = options; return { messageId: 'rental-fixture' } },
  }))
  const result = await sendPropertyAlert(savedSearch({ listingPurpose: 'rent', minPrice: 0, maxPrice: 900.01 }), [
    property(33, { listingPurpose: 'rent', price: 1000.01, offerPercent: 10 }),
  ])
  assert.equal(result.success, true)
  assert.match(mail.html, /KSh 900\.01 \/ month/)
  assert.match(mail.text, /KSh 900\.01 \/ month/)
  assert.match(mail.html, /<del>KSh 1,000\.01<\/del>/)
  assert.match(mail.html, /10% off/)
  assert.match(mail.html, /Effective monthly rent range: KSh 0 - KSh 900\.01 \/ month/)
})

test('saved-search update rejects operator and dotted criteria bypasses before storage', async t => {
  let updates = 0
  stub(t, SavedSearch, 'findOneAndUpdate', async () => { updates += 1; return null })
  const token = verifiedSession(t)
  const api = await serve(app)
  t.after(() => api.close())
  for (const payload of [
    { $set: { 'searchCriteria.minPrice': -1 } },
    { 'searchCriteria.listingPurpose': 'lease' },
    { 'searchCriteria.maxPrice': 1, 'searchCriteria.minPrice': 20 },
  ]) {
    const response = await privateRequest(api, token, 'PUT', '/api/saved-searches/64b000000000000000000001', payload)
    assert.equal(response.status, 400)
  }
  assert.equal(updates, 0)
})
