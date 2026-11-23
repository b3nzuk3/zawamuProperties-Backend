import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import nodemailer from 'nodemailer'
import app from '../src/app.js'
import Property from '../src/models/Property.js'
import SavedSearch from '../src/models/SavedSearch.js'
import SavedSearchAccessLink from '../src/models/SavedSearchAccessLink.js'
import SavedSearchSession from '../src/models/SavedSearchSession.js'
import { serve, stub } from './helpers/http.js'

const SEARCH_ID = '64b000000000000000000001'
const SESSION_TOKEN = randomBytes(32).toString('base64url')
const sessionHash = token => createHash('sha256').update(token).digest('hex')

async function request(api, method, path, { body, session, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${api.server.address().port}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(session ? { 'X-Saved-Search-Session': session } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, data, cacheControl: response.headers.get('cache-control') }
}

function savedSearchFixture(fields = {}) {
  return {
    _id: SEARCH_ID,
    userEmail: 'visitor@example.test',
    userName: 'Visitor',
    userPhone: '+254700000000',
    name: 'Eastlands homes',
    description: 'Two-bedroom homes',
    searchCriteria: { location: 'Eastlands', minBedrooms: 2 },
    alertSettings: { isActive: false, frequency: 'daily', maxAlertsPerDay: 5 },
    isActive: true,
    totalAlertsSent: 17,
    alertsSentToday: 2,
    internalTokenHash: 'private-digest',
    ...fields,
  }
}

function listQuery(rows) {
  const query = Promise.resolve(rows)
  query.sort = () => query
  query.skip = () => query
  query.limit = () => query
  return query
}

function cursorQuery(rows, observed = {}) {
  const query = {
    sort(order) { observed.sort = order; return this },
    cursor(options) {
      observed.options = options
      let closed = false
      return {
        async *[Symbol.asyncIterator]() {
          for (const row of rows) yield row
        },
        async close() { closed = true; observed.closed = closed },
      }
    },
  }
  return query
}

function preserveAccessEnv(t) {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'FRONTEND_URL', 'EMAIL_FROM']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
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

test('guest saved-search reads and mutations fail closed without a verified management session', async t => {
  let savedSearchQueries = 0
  stub(t, SavedSearch, 'find', () => { savedSearchQueries += 1; return listQuery([]) })
  stub(t, SavedSearch, 'findOne', async () => { savedSearchQueries += 1; return null })
  stub(t, SavedSearch, 'findById', async () => { savedSearchQueries += 1; return null })
  stub(t, SavedSearch, 'findOneAndUpdate', async () => { savedSearchQueries += 1; return null })
  stub(t, SavedSearchSession, 'findOne', async () => { throw new Error('missing header must not query sessions') })
  const api = await serve(app)
  t.after(api.close)

  const cases = [
    ['GET', '/api/saved-searches'],
    ['GET', '/api/saved-searches/user/visitor@example.test'],
    ['GET', `/api/saved-searches/${SEARCH_ID}`],
    ['GET', `/api/saved-searches/${SEARCH_ID}/properties`],
    ['PUT', `/api/saved-searches/${SEARCH_ID}`, { name: 'Changed' }],
    ['DELETE', `/api/saved-searches/${SEARCH_ID}`],
  ]
  for (const [method, path, body] of cases) {
    const result = await request(api, method, path, { body })
    assert.equal(result.status, 401, `${method} ${path}`)
    assert.equal(result.cacheControl, 'no-store')
    assert.deepEqual(Object.keys(result.data).sort(), ['message', 'success'])
  }
  const adminJwtOnly = await request(api, 'GET', '/api/saved-searches', { headers: { Authorization: 'Bearer unrelated-admin-token' } })
  assert.equal(adminJwtOnly.status, 401)
  assert.equal(savedSearchQueries, 0)
})

test('a verified session can first-stamp an existing pending search through Mongoose update casting', () => {
  const now = new Date('2026-11-23T12:00:00.000Z')
  const update = SavedSearch.findOneAndUpdate(
    { _id: SEARCH_ID, userEmail: 'visitor@example.test', isActive: true },
    { $set: { verifiedAt: now, alertConsentAt: now } },
    { new: true, runValidators: true },
  )
  const castUpdate = update._castUpdate(update.getUpdate())
  assert.equal(castUpdate.$set.verifiedAt.getTime(), now.getTime())
  assert.equal(castUpdate.$set.alertConsentAt.getTime(), now.getTime())
})

test('access-token schemas persist only unique digests with TTL cleanup indexes', () => {
  for (const model of [SavedSearchAccessLink, SavedSearchSession]) {
    assert.equal(model.schema.path('tokenHash').options.select, false)
    const indexes = model.schema.indexes()
    assert.ok(indexes.some(([fields, options]) => fields.tokenHash === 1 && options.unique === true))
    assert.ok(indexes.some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0))
  }
})

test('access links are generic, trusted-origin fragment links, SHA-256 stored and explicitly consumed once', async t => {
  preserveAccessEnv(t)
  configureMail()
  let mail
  let persistedLink
  let persistedSession
  let linkConsumeAttempts = 0
  stub(t, nodemailer, 'createTransport', () => ({ sendMail: async value => { mail = value; return { messageId: 'fixture' } } }))
  stub(t, SavedSearchAccessLink, 'create', async value => { persistedLink = { ...value }; return persistedLink })
  stub(t, SavedSearchAccessLink, 'findOneAndUpdate', async (filter, update) => {
    linkConsumeAttempts += 1
    assert.equal(filter.tokenHash, persistedLink.tokenHash)
    assert.equal(filter.consumedAt, null)
    if (persistedLink.consumedAt || persistedLink.expiresAt <= filter.expiresAt.$gt) return null
    persistedLink.consumedAt = update.$set.consumedAt
    return { ...persistedLink }
  })
  stub(t, SavedSearchSession, 'create', async value => { persistedSession = { ...value }; return persistedSession })
  const api = await serve(app)
  t.after(api.close)

  const sent = await request(api, 'POST', '/api/saved-searches/access-links', { body: { email: 'Visitor@Example.Test' } })
  assert.equal(sent.status, 202)
  assert.equal(sent.cacheControl, 'no-store')
  assert.deepEqual(Object.keys(sent.data).sort(), ['message', 'success'])
  assert.equal(sent.data.success, true)
  assert.equal(persistedLink.email, 'visitor@example.test')
  assert.match(persistedLink.tokenHash, /^[a-f0-9]{64}$/)
  assert.notEqual(persistedLink.tokenHash, mail.html.match(/saved-search-token=([^"&]+)/)?.[1])
  assert.equal(mail.to, 'visitor@example.test')
  assert.equal(mail.from, 'Zawamu <alerts@example.test>')
  assert.match(mail.html, /https:\/\/www\.zawamu\.test\/dashboard#saved-search-token=/)
  assert.doesNotMatch(mail.html, /\?saved-search-token=|&saved-search-token=/)

  const rawToken = decodeURIComponent(mail.html.match(/saved-search-token=([^"&]+)/)[1])
  const getScan = await request(api, 'GET', `/api/saved-searches/access-links/consume?token=${rawToken}`)
  assert.equal(getScan.status, 404)
  assert.equal(linkConsumeAttempts, 0)

  const consumed = await request(api, 'POST', '/api/saved-searches/access-links/consume', { body: { token: rawToken } })
  assert.equal(consumed.status, 200)
  assert.equal(consumed.cacheControl, 'no-store')
  assert.deepEqual(Object.keys(consumed.data.data).sort(), ['email', 'expiresAt', 'token'])
  assert.equal(consumed.data.data.email, 'visitor@example.test')
  assert.equal(persistedSession.email, 'visitor@example.test')
  assert.equal(persistedSession.tokenHash, sessionHash(consumed.data.data.token))
  assert.notEqual(persistedSession.tokenHash, consumed.data.data.token)
  assert.equal(Object.hasOwn(persistedLink, 'token'), false)

  const replay = await request(api, 'POST', '/api/saved-searches/access-links/consume', { body: { token: rawToken } })
  assert.equal(replay.status, 401)
  assert.equal(linkConsumeAttempts, 2)
})

test('SMTP failure revokes the stored access digest and keeps the public receipt generic', async t => {
  preserveAccessEnv(t)
  configureMail()
  let persistedLink
  let revocation
  let attemptedMail
  stub(t, nodemailer, 'createTransport', () => ({ sendMail: async value => { attemptedMail = value; throw new Error('private provider response') } }))
  stub(t, SavedSearchAccessLink, 'create', async value => { persistedLink = { ...value }; return persistedLink })
  stub(t, SavedSearchAccessLink, 'updateOne', async (filter, update) => { revocation = { filter, update }; return { modifiedCount: 1 } })
  const api = await serve(app)
  t.after(api.close)

  const result = await request(api, 'POST', '/api/saved-searches/access-links', { body: { email: 'delivery-failure@example.test' } })
  assert.equal(result.status, 202)
  assert.equal(result.data.success, true)
  assert.doesNotMatch(JSON.stringify(result.data), /private provider response|delivery-failure@example\.test|saved-search-token/)
  assert.equal(revocation.filter.tokenHash, persistedLink.tokenHash)
  assert.equal(revocation.update.$set.revokedAt instanceof Date, true)
  assert.equal(persistedLink.tokenHash, sessionHash(attemptedMail.html.match(/saved-search-token=([^"&]+)/)[1]))
})

test('pending public save persists inactive consent state, requests a link and returns no private metadata', async t => {
  preserveAccessEnv(t)
  configureMail()
  let persisted
  let mail
  stub(t, nodemailer, 'createTransport', () => ({ sendMail: async value => { mail = value; return {} } }))
  stub(t, SavedSearch, 'findOne', async () => null)
  stub(t, SavedSearch, 'create', async value => { persisted = { ...value }; return savedSearchFixture(value) })
  stub(t, SavedSearchAccessLink, 'create', async value => value)
  const api = await serve(app)
  t.after(api.close)

  const result = await request(api, 'POST', '/api/saved-searches', {
    body: {
      userEmail: 'Visitor@Example.Test', userName: 'Visitor', userPhone: '+254700000000',
      name: 'Eastlands homes', description: 'Two-bedroom homes', searchCriteria: { location: ' Eastlands ', minBedrooms: 2 },
      alertSettings: { isActive: true, frequency: 'weekly', maxAlertsPerDay: 2 },
    },
  })
  assert.equal(result.status, 202)
  assert.equal(result.cacheControl, 'no-store')
  assert.deepEqual(Object.keys(result.data).sort(), ['message', 'success'])
  assert.equal(persisted.userEmail, 'visitor@example.test')
  assert.deepEqual(persisted.searchCriteria, { location: 'Eastlands', minBedrooms: 2 })
  assert.equal(persisted.alertSettings.isActive, false)
  assert.equal(persisted.alertSettings.frequency, 'weekly')
  assert.equal(Object.hasOwn(persisted, 'verifiedAt'), false)
  assert.equal(Object.hasOwn(persisted, 'alertConsentAt'), false)
  assert.equal(mail.to, 'visitor@example.test')
  assert.doesNotMatch(JSON.stringify(result.data), /visitor@example\.test|Eastlands|64b000/)
})

test('verified POST derives immutable email from its session and returns the private DTO with explicit consent', async t => {
  const email = 'session-owner@example.test'
  let savedDocument
  let createCalls = 0
  stub(t, SavedSearchSession, 'findOne', async () => ({ email, expiresAt: new Date(Date.now() + 60_000), revokedAt: null }))
  stub(t, SavedSearch, 'findOne', async () => null)
  stub(t, SavedSearch, 'create', async value => { createCalls += 1; savedDocument = { ...value }; return savedSearchFixture(value) })
  const api = await serve(app)
  t.after(api.close)

  const mismatch = await request(api, 'POST', '/api/saved-searches', {
    session: SESSION_TOKEN,
    body: { userEmail: 'attacker@example.test', userName: 'Visitor', name: 'Search', searchCriteria: {} },
  })
  assert.equal(mismatch.status, 400)
  assert.equal(createCalls, 0)

  const created = await request(api, 'POST', '/api/saved-searches', {
    session: SESSION_TOKEN,
    body: { userName: 'Visitor', name: 'Search', searchCriteria: {}, alertSettings: { isActive: true } },
  })
  assert.equal(created.status, 201)
  assert.equal(savedDocument.userEmail, email)
  assert.ok(savedDocument.verifiedAt instanceof Date)
  assert.ok(savedDocument.alertConsentAt instanceof Date)
  assert.equal(savedDocument.alertSettings.isActive, true)
  assert.equal(created.data.data.userEmail, email)
  assert.equal(created.data.data.verifiedAt, savedDocument.verifiedAt.toISOString())
  assert.equal(created.data.data.alertConsentAt, savedDocument.alertConsentAt.toISOString())
  assert.equal(Object.hasOwn(created.data.data, 'tokenHash'), false)
})

test('verified session scopes owner DTOs and explicit opt-in is recorded from that proof only', async t => {
  const email = 'visitor@example.test'
  const session = { email, expiresAt: new Date(Date.now() + 60_000), revokedAt: null }
  const fixture = savedSearchFixture({ verifiedAt: undefined, alertConsentAt: undefined })
  let listFilter
  let updateFilter
  let updatePayload
  stub(t, SavedSearchSession, 'findOne', filter => {
    assert.equal(filter.tokenHash, sessionHash(SESSION_TOKEN))
    return session
  })
  stub(t, SavedSearch, 'find', filter => { listFilter = filter; return listQuery([fixture]) })
  stub(t, SavedSearch, 'countDocuments', async filter => {
    assert.deepEqual(filter, { userEmail: email, isActive: true })
    return 1
  })
  stub(t, SavedSearch, 'findOne', async filter => {
    assert.equal(filter.userEmail, email)
    return filter._id === SEARCH_ID ? fixture : null
  })
  stub(t, SavedSearch, 'findOneAndUpdate', async (filter, update) => {
    updateFilter = filter
    updatePayload = update
    return { ...fixture, ...update.$set }
  })
  const api = await serve(app)
  t.after(api.close)

  const list = await request(api, 'GET', '/api/saved-searches', { session: SESSION_TOKEN })
  assert.equal(list.status, 200)
  assert.equal(listFilter.userEmail, email)
  assert.equal(listFilter.isActive, true)
  assert.equal(list.data.data.length, 1)
  const dto = list.data.data[0]
  assert.deepEqual(Object.keys(dto).sort(), [
    '_id', 'alertConsentAt', 'alertSettings', 'createdAt', 'description', 'isActive', 'name', 'searchCriteria', 'updatedAt', 'userEmail', 'userName', 'userPhone', 'verifiedAt',
  ].sort())
  assert.equal(dto.userEmail, email)
  assert.equal(Object.hasOwn(dto, 'internalTokenHash'), false)
  assert.equal(Object.hasOwn(dto, 'totalAlertsSent'), false)

  const detail = await request(api, 'GET', `/api/saved-searches/${SEARCH_ID}`, { session: SESSION_TOKEN })
  assert.equal(detail.status, 200)
  assert.equal(detail.data.data._id, SEARCH_ID)
  assert.equal(Object.hasOwn(detail.data.data, 'internalTokenHash'), false)

  const wrongScope = await request(api, 'GET', '/api/saved-searches/user/attacker@example.test', { session: SESSION_TOKEN })
  assert.equal(wrongScope.status, 404)
  const foreignSearch = await request(api, 'GET', '/api/saved-searches/64b000000000000000000099', { session: SESSION_TOKEN })
  assert.equal(foreignSearch.status, 404)
  const attemptedEmailChange = await request(api, 'PUT', `/api/saved-searches/${SEARCH_ID}`, {
    session: SESSION_TOKEN,
    body: { userEmail: 'attacker@example.test' },
  })
  assert.equal(attemptedEmailChange.status, 400)

  const optIn = await request(api, 'PUT', `/api/saved-searches/${SEARCH_ID}`, {
    session: SESSION_TOKEN,
    body: { alertSettings: { isActive: true, frequency: 'daily', maxAlertsPerDay: 3 } },
  })
  assert.equal(optIn.status, 200)
  assert.equal(updateFilter.userEmail, email)
  assert.equal(updateFilter._id, SEARCH_ID)
  assert.equal(updatePayload.$set.alertSettings.isActive, true)
  assert.ok(updatePayload.$set.verifiedAt instanceof Date)
  assert.ok(updatePayload.$set.alertConsentAt instanceof Date)
  assert.equal(optIn.data.data.userEmail, email)
  assert.equal(optIn.data.data.alertConsentAt, updatePayload.$set.alertConsentAt.toISOString())
  assert.equal(Object.hasOwn(optIn.data.data, 'token'), false)

  const deleted = await request(api, 'DELETE', `/api/saved-searches/${SEARCH_ID}`, { session: SESSION_TOKEN })
  assert.equal(deleted.status, 200)
  assert.equal(updateFilter.userEmail, email)
  assert.equal(updatePayload.$set.isActive, false)
  assert.equal(updatePayload.$set['alertSettings.isActive'], false)
  assert.equal(updatePayload.$set.alertConsentAt, null)
})

test('private matching results preserve the exact matcher while cursor pagination bounds retained memory', async t => {
  const session = { email: 'visitor@example.test', expiresAt: new Date(Date.now() + 60_000), revokedAt: null }
  const search = savedSearchFixture({ matchesProperty: value => value.keep })
  const candidates = [
    { _id: '64b000000000000000000011', keep: true, title: 'first' },
    { _id: '64b000000000000000000012', keep: false, title: 'skip' },
    { _id: '64b000000000000000000013', keep: true, title: 'third' },
    { _id: '64b000000000000000000014', keep: true, title: 'fourth' },
  ]
  const observed = {}
  stub(t, SavedSearchSession, 'findOne', () => session)
  stub(t, SavedSearch, 'findOne', filter => {
    assert.equal(filter.userEmail, session.email)
    return search
  })
  stub(t, Property, 'find', filter => {
    assert.deepEqual(filter, {})
    return cursorQuery(candidates, observed)
  })
  const api = await serve(app)
  t.after(api.close)

  const result = await request(api, 'GET', `/api/saved-searches/${SEARCH_ID}/properties?page=2&limit=1`, { session: SESSION_TOKEN })
  assert.equal(result.status, 200)
  assert.deepEqual(result.data.data.properties.map(row => row._id), ['64b000000000000000000013'])
  assert.deepEqual(result.data.data.pagination, {
    currentPage: 2, totalPages: 3, totalProperties: 3, hasNextPage: true, hasPrevPage: true,
  })
  assert.deepEqual(observed.sort, { createdAt: -1, _id: -1 })
  assert.deepEqual(observed.options, { batchSize: 100 })
  assert.equal(observed.closed, true)
  assert.equal(result.cacheControl, 'no-store')
})

test('IDs, alert settings and update fields are validated before storage; session logout revokes only its digest', async t => {
  let searchReads = 0
  let revokeFilter
  stub(t, SavedSearchSession, 'findOne', filter => ({ email: 'visitor@example.test', expiresAt: new Date(Date.now() + 60_000), revokedAt: null }))
  stub(t, SavedSearch, 'findOne', async () => { searchReads += 1; return savedSearchFixture() })
  stub(t, SavedSearch, 'findOneAndUpdate', async () => { searchReads += 1; return savedSearchFixture() })
  stub(t, SavedSearchSession, 'updateOne', async filter => { revokeFilter = filter; return { modifiedCount: 1 } })
  const api = await serve(app)
  t.after(api.close)

  for (const [method, path, body, expectedStatus] of [
    ['GET', '/api/saved-searches/not-an-object-id', undefined, 404],
    ['PUT', '/api/saved-searches/not-an-object-id', { name: 'x' }, 404],
    ['DELETE', '/api/saved-searches/not-an-object-id', undefined, 404],
    ['PUT', `/api/saved-searches/${SEARCH_ID}`, { alertSettings: { isActive: 'true' } }, 400],
    ['PUT', `/api/saved-searches/${SEARCH_ID}`, { alertSettings: { isActive: true, unexpected: true } }, 400],
    ['PUT', `/api/saved-searches/${SEARCH_ID}`, { name: 'ok', '$set': { isActive: true } }, 400],
  ]) {
    const result = await request(api, method, path, { body, session: SESSION_TOKEN })
    assert.equal(result.status, expectedStatus)
  }
  assert.equal(searchReads, 0)
  const logout = await request(api, 'DELETE', '/api/saved-searches/session', { session: SESSION_TOKEN })
  assert.equal(logout.status, 200)
  assert.deepEqual(revokeFilter, { tokenHash: sessionHash(SESSION_TOKEN), revokedAt: null })
})

test('expired or revoked management sessions cannot read private saved searches', async t => {
  let savedSearchReads = 0
  stub(t, SavedSearchSession, 'findOne', async () => ({
    email: 'visitor@example.test',
    expiresAt: new Date(Date.now() - 1000),
    revokedAt: null,
  }))
  stub(t, SavedSearch, 'find', () => { savedSearchReads += 1; return listQuery([]) })
  const api = await serve(app)
  t.after(api.close)
  const expired = await request(api, 'GET', '/api/saved-searches', { session: SESSION_TOKEN })
  assert.equal(expired.status, 401)
  assert.equal(expired.cacheControl, 'no-store')
  assert.equal(savedSearchReads, 0)
})

test('access-link endpoint applies a bounded per-email limit and returns no-store generic receipts', async t => {
  preserveAccessEnv(t)
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_FROM', 'FRONTEND_URL']) delete process.env[key]
  const api = await serve(app)
  t.after(api.close)

  const body = { email: 'throttled@example.test' }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await request(api, 'POST', '/api/saved-searches/access-links', { body })
    assert.equal(result.status, 202)
    assert.deepEqual(Object.keys(result.data).sort(), ['message', 'success'])
    assert.equal(result.cacheControl, 'no-store')
  }
  const limited = await request(api, 'POST', '/api/saved-searches/access-links', { body })
  assert.equal(limited.status, 429)
  assert.deepEqual(Object.keys(limited.data).sort(), ['message', 'success'])
  assert.equal(limited.cacheControl, 'no-store')
})

test('saved-search JSON parser failures retain CORS and no-store headers', async t => {
  const api = await serve(app)
  t.after(api.close)
  const url = `http://127.0.0.1:${api.server.address().port}/api/saved-searches/access-links`
  const malformed = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://frontend.example.test' },
    body: '{',
  })
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { success: false, message: 'Invalid saved-search request' })
  assert.equal(malformed.headers.get('cache-control'), 'no-store')
  assert.equal(malformed.headers.get('access-control-allow-origin'), '*')

  const oversized = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://frontend.example.test' },
    body: JSON.stringify({ email: `${'a'.repeat(110_000)}@example.test` }),
  })
  assert.equal(oversized.status, 413)
  assert.deepEqual(await oversized.json(), { success: false, message: 'Saved-search request is too large' })
  assert.equal(oversized.headers.get('cache-control'), 'no-store')
  assert.equal(oversized.headers.get('access-control-allow-origin'), '*')
})

test('legacy alert GET is disabled and owner POST delegates to the durable runner', async t => {
  const previous = {
    JWT_SECRET: process.env.JWT_SECRET,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    SAVED_SEARCH_ALERTS_ENABLED: process.env.SAVED_SEARCH_ALERTS_ENABLED,
  }
  process.env.JWT_SECRET = 'local-test-secret-not-for-deployment'
  process.env.ADMIN_EMAILS = 'owner@example.test'
  process.env.SAVED_SEARCH_ALERTS_ENABLED = 'false'
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value
  })
  const { default: jwt } = await import('jsonwebtoken')
  const token = jwt.sign({ userId: 'owner' }, process.env.JWT_SECRET)
  const { default: User } = await import('../src/models/User.js')
  stub(t, User, 'findById', () => ({ email: 'owner@example.test' }))
  const api = await serve(app)
  t.after(api.close)

  const oldGet = await request(api, 'GET', '/api/saved-searches/admin/check-matches')
  assert.equal(oldGet.status, 405)
  const post = await request(api, 'POST', '/api/saved-searches/admin/check-matches', { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(post.status, 200)
  assert.equal(post.cacheControl, 'no-store')
  assert.equal(post.data.success, true)
  assert.equal(post.data.data.disabled, true)
  assert.equal(post.data.data.dryRun, true)
})
