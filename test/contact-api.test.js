import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import User from '../src/models/User.js'
import Contact from '../src/models/Contact.js'
import Property from '../src/models/Property.js'
import nodemailer from 'nodemailer'
import { contactSubmissionRateLimiter } from '../src/middleware/contactRateLimiter.js'
import { parseContactSubmission } from '../src/utils/contactRules.js'
import { serve, stub } from './helpers/http.js'

const CONTACT_ID = '64b000000000000000000001'
const PROPERTY_ID = '64b000000000000000000002'

function mockQuery(value, onResolve = result => result) {
  const state = { skip: 0, limit: Infinity, sort: null }
  const query = {
    sort(spec) { state.sort = spec; return query },
    skip(count) { state.skip = count; return query },
    limit(count) { state.limit = count; return query },
    select() { return query },
    then(resolve, reject) {
      return Promise.resolve(typeof value === 'function' ? value(state) : value)
        .then(onResolve).then(resolve, reject)
    },
  }
  return query
}

function clone(value) {
  return value == null ? value : structuredClone(value)
}

function setPath(object, path, value) {
  const parts = path.split('.')
  let target = object
  for (const part of parts.slice(0, -1)) target = target[part] ??= {}
  target[parts.at(-1)] = value
}

function getPath(object, path) {
  return path.split('.').reduce((value, part) => value?.[part], object)
}

function applyUpdate(record, update) {
  for (const [path, value] of Object.entries(update.$set ?? {})) setPath(record, path, value)
  for (const [path, amount] of Object.entries(update.$inc ?? {})) setPath(record, path, (getPath(record, path) ?? 0) + amount)
  for (const path of Object.keys(update.$unset ?? {})) {
    const parts = path.split('.')
    const parent = parts.slice(0, -1).reduce((value, part) => value?.[part], record)
    if (parent) delete parent[parts.at(-1)]
  }
}

function matchesClaim(record, filter) {
  if (!record || String(record._id) !== String(filter._id)) return false
  const attempts = getPath(record, 'notification.attempts')
  if (attempts !== undefined && attempts >= 5) return false
  const state = getPath(record, 'notification.status')
  const leaseUntil = getPath(record, 'notification.leaseUntil')
  if (state === 'pending' || state === 'failed' || state === undefined) return true
  return state === 'sending' && leaseUntil && new Date(leaseUntil).getTime() <= Date.now()
}

function matchesContactFilter(record, filter) {
  if (filter.$and && !filter.$and.every(clause => matchesContactFilter(record, clause))) return false
  if (filter.$or && !filter.$or.some(clause => matchesContactFilter(record, clause))) return false
  for (const [field, condition] of Object.entries(filter)) {
    if (field === '$and' || field === '$or') continue
    const value = record[field]
    if (condition && typeof condition === 'object' && '$exists' in condition) {
      if (condition.$exists === false && value !== undefined) return false
      if (condition.$exists === true && value === undefined) return false
    } else if (condition === null) {
      if (value !== null && value !== undefined) return false
    } else if (value !== condition) return false
  }
  return true
}

test('Contact schema projects legacy defaults without mutating the raw record', () => {
  const legacy = {
    _id: CONTACT_ID,
    name: 'Legacy visitor',
    email: 'legacy@example.test',
    message: 'Old contact',
  }
  const hydrated = Contact.hydrate(legacy)
  assert.equal(hydrated.source, 'general')
  assert.equal(hydrated.status, 'new')
  assert.equal(hydrated.notification.status, 'pending')
  assert.equal(hydrated.notification.attempts, 0)
  assert.equal(Object.hasOwn(legacy, 'source'), false)
  assert.equal(Object.hasOwn(legacy, 'status'), false)
  assert.equal(Object.hasOwn(legacy, 'notification'), false)
})

async function setup(t, { initial = [], property = { _id: PROPERTY_ID, title: 'Stored listing', availability: 'sold' } } = {}) {
  contactSubmissionRateLimiter.resetKey?.('127.0.0.1')
  const envKeys = ['JWT_SECRET', 'ADMIN_EMAILS', 'FRONTEND_URL', 'TRUST_PROXY_HOPS', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'CONTACT_NOTIFICATION_EMAIL']
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  process.env.JWT_SECRET = 'contact-api-test-secret-not-for-deployment'
  process.env.ADMIN_EMAILS = 'owner@example.test'
  process.env.FRONTEND_URL = 'https://www.zawamu.test/'
  process.env.TRUST_PROXY_HOPS = '0'
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'CONTACT_NOTIFICATION_EMAIL']) delete process.env[key]
  t.after(() => {
    contactSubmissionRateLimiter.resetKey?.('127.0.0.1')
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value
  })

  let actor = { _id: 'actor', email: 'owner@example.test' }
  // Model and SMTP methods are explicit fakes; requests use real Express over loopback HTTP.
  const records = new Map(initial.map(record => [String(record._id), clone(record)]))
  stub(t, User, 'findById', id => mockQuery(id === 'actor' ? actor : null))
  stub(t, Property, 'findById', id => mockQuery(String(id) === PROPERTY_ID ? clone(property) : null))
  stub(t, Contact, 'create', async fields => {
    const validationError = new Contact(fields).validateSync()
    if (validationError) throw validationError
    const record = { _id: CONTACT_ID, createdAt: new Date('2026-11-19T10:00:00.000Z'), ...clone(fields) }
    records.set(CONTACT_ID, record)
    return clone(record)
  })
  stub(t, Contact, 'find', filter => mockQuery(state => {
    let items = [...records.values()].filter(record => matchesContactFilter(record, filter))
    if (state.sort) items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || String(b._id).localeCompare(String(a._id)))
    return items.slice(state.skip, state.skip + state.limit).map(clone)
  }))
  stub(t, Contact, 'countDocuments', async filter => [...records.values()].filter(record => matchesContactFilter(record, filter)).length)
  stub(t, Contact, 'findById', id => mockQuery(records.get(String(id)) ? clone(records.get(String(id))) : null))
  stub(t, Contact, 'findByIdAndUpdate', async (id, update) => {
    const record = records.get(String(id))
    if (!record) return null
    applyUpdate(record, update)
    return clone(record)
  })
  stub(t, Contact, 'findOneAndUpdate', async (filter, update) => {
    const record = records.get(String(filter._id))
    const finishingLease = typeof filter['notification.leaseToken'] === 'string'
    if (finishingLease) {
      if (getPath(record, 'notification.leaseToken') !== filter['notification.leaseToken']) return null
    } else if (!matchesClaim(record, filter)) return null
    applyUpdate(record, update)
    return clone(record)
  })
  const transport = { sendMail: async () => ({ messageId: 'mock-message' }) }
  stub(t, nodemailer, 'createTransport', () => transport)

  const { default: app } = await import('../src/app.js')
  const api = await serve(app)
  t.after(api.close)
  return {
    ...api,
    app,
    records,
    actor: value => { actor = value },
    token: () => jwt.sign({ userId: 'actor', isAdmin: true }, process.env.JWT_SECRET),
    property,
    transport,
  }
}

test('public general contact persists before notification and returns only the receipt', async t => {
  const api = await setup(t)
  process.env.SMTP_HOST = 'smtp.example.test'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_FROM = 'notifications@example.test'
  process.env.CONTACT_NOTIFICATION_EMAIL = 'inbox@example.test'
  const callOrder = []
  const originalCreate = Contact.create
  Contact.create = async fields => { callOrder.push('persist'); return originalCreate(fields) }
  const originalSend = api.transport.sendMail
  api.transport.sendMail = async () => { callOrder.push('mail'); return originalSend() }

  const response = await api.request('POST', '/api/contact', undefined, {
    name: '  Visitor One ', email: ' Person@Example.test ', message: ' I would like details.\r\nPlease call. ', phone: ' +254700000001 ',
  })
  assert.equal(response.status, 201)
  assert.deepEqual(response.data, { message: 'Your enquiry has been received.', received: true })
  assert.deepEqual(callOrder, ['persist', 'mail'])
  const saved = api.records.get(CONTACT_ID)
  assert.equal(saved.name, 'Visitor One')
  assert.equal(saved.email, 'person@example.test')
  assert.equal(saved.message, 'I would like details.\nPlease call.')
  assert.equal(saved.source, 'general')
  assert.equal(saved.status, 'new')
  assert.equal(saved.notification.attempts, 1)
  assert.equal(saved.notification.status, 'sent')
  assert.equal(Object.hasOwn(response.data, 'email'), false)
})

test('property contact snapshots trusted stored title and configured URL, including sold listings', async t => {
  const api = await setup(t)
  const response = await api.request('POST', '/api/contact', undefined, {
    name: 'Visitor', email: 'visitor@example.test', message: 'Is this still available?',
    source: 'property', propertyId: PROPERTY_ID,
  })
  assert.equal(response.status, 201)
  const saved = api.records.get(CONTACT_ID)
  assert.equal(saved.source, 'property')
  assert.equal(saved.propertyTitle, 'Stored listing')
  assert.equal(saved.propertyUrl, `https://www.zawamu.test/listings/${PROPERTY_ID}`)
  assert.equal(api.property.availability, 'sold')
})

test('property notification retry rebuilds its link from persisted propertyId and current trusted origin', async t => {
  const api = await setup(t)
  delete process.env.FRONTEND_URL
  const response = await api.request('POST', '/api/contact', undefined, {
    name: 'Visitor', email: 'visitor@example.test', message: 'Please send details.',
    source: 'property', propertyId: PROPERTY_ID,
  })
  assert.equal(response.status, 201)
  const saved = api.records.get(CONTACT_ID)
  assert.equal(saved.propertyId, PROPERTY_ID)
  assert.equal(saved.propertyTitle, 'Stored listing')
  assert.equal(saved.propertyUrl, null)
  assert.equal(saved.notification.status, 'failed')
  assert.equal(saved.notification.lastError, 'notification_not_configured')

  process.env.FRONTEND_URL = 'https://retry.zawamu.test/'
  process.env.SMTP_HOST = 'smtp.example.test'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_FROM = 'notifications@example.test'
  process.env.CONTACT_NOTIFICATION_EMAIL = 'inbox@example.test'
  let mail
  api.transport.sendMail = async options => { mail = options; return { messageId: 'retry-message' } }
  const retry = await api.request('POST', `/api/contact/${CONTACT_ID}/retry-notification`, api.token())
  assert.equal(retry.status, 200)
  assert.equal(saved.notification.status, 'sent')
  assert.equal(saved.propertyUrl, null, 'the submission-time URL snapshot remains unchanged')
  assert.match(mail.text, new RegExp(`https://retry\\.zawamu\\.test/listings/${PROPERTY_ID}`))
  assert.match(mail.html, new RegExp(`href="https://retry\\.zawamu\\.test/listings/${PROPERTY_ID}"`))
  assert.doesNotMatch(mail.text, /zawamu\.test\/listings\/attacker/i)
  assert.match(mail.text, /Property: Stored listing/)
})

test('property retry never uses an unsafe historical propertyUrl', async t => {
  const historical = {
    _id: CONTACT_ID,
    name: 'Visitor',
    email: 'visitor@example.test',
    message: 'Please send details.',
    source: 'property',
    propertyId: PROPERTY_ID,
    propertyTitle: 'Historical title',
    propertyUrl: 'https://attacker.example.test/listings/attacker',
    status: 'new',
    notification: { status: 'failed', attempts: 1, lastError: 'notification_not_configured' },
  }
  const api = await setup(t, { initial: [historical] })
  process.env.SMTP_HOST = 'smtp.example.test'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_FROM = 'notifications@example.test'
  process.env.CONTACT_NOTIFICATION_EMAIL = 'inbox@example.test'
  let mail
  api.transport.sendMail = async options => { mail = options; return { messageId: 'retry-message' } }

  const retry = await api.request('POST', `/api/contact/${CONTACT_ID}/retry-notification`, api.token())
  assert.equal(retry.status, 200)
  assert.match(mail.text, new RegExp(`https://www\\.zawamu\\.test/listings/${PROPERTY_ID}`))
  assert.match(mail.html, new RegExp(`href="https://www\\.zawamu\\.test/listings/${PROPERTY_ID}"`))
  assert.doesNotMatch(mail.text, /attacker\.example\.test/)
  assert.doesNotMatch(mail.html, /attacker\.example\.test/)
})

test('property enquiries persist unbounded stored listing titles and escape malicious title HTML', async t => {
  const title = `Listing <img src=x onerror=alert(1)> ${'context '.repeat(29)}context`
  assert.ok(title.length > 200, 'regression title exceeds the former Contact snapshot limit')
  const api = await setup(t, { property: { _id: PROPERTY_ID, title, availability: 'available' } })
  process.env.SMTP_HOST = 'smtp.example.test'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_FROM = 'notifications@example.test'
  process.env.CONTACT_NOTIFICATION_EMAIL = 'inbox@example.test'
  let mail
  api.transport.sendMail = async options => { mail = options; return { messageId: 'long-title-message' } }

  const response = await api.request('POST', '/api/contact', undefined, {
    name: 'Visitor', email: 'visitor@example.test', message: 'Please send details.',
    source: 'property', propertyId: PROPERTY_ID,
  })
  assert.equal(response.status, 201)
  assert.equal(api.records.get(CONTACT_ID).propertyTitle, title)
  assert.equal(new Contact({
    name: 'Visitor', email: 'visitor@example.test', message: 'Please send details.',
    source: 'property', propertyId: PROPERTY_ID, propertyTitle: title,
  }).validateSync(), undefined)
  assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(mail.html, /<img src=x onerror=alert\(1\)>/)
})

test('missing SMTP records notification failure but does not fail or expose the public receipt', async t => {
  const api = await setup(t)
  let sendCalls = 0
  api.transport.sendMail = async () => { sendCalls += 1; return { messageId: 'should-not-send' } }
  const response = await api.request('POST', '/api/contact', undefined, {
    name: 'Visitor', email: 'visitor@example.test', message: 'Please call me',
  })
  assert.equal(response.status, 201)
  assert.deepEqual(response.data, { message: 'Your enquiry has been received.', received: true })
  assert.equal(sendCalls, 0)
  assert.equal(api.records.get(CONTACT_ID).notification.status, 'failed')
  assert.equal(api.records.get(CONTACT_ID).notification.attempts, 1)
  assert.equal(api.records.get(CONTACT_ID).notification.lastError, 'notification_not_configured')
})

test('ambiguous SMTP failure is persisted safely while the enquiry remains accepted', async t => {
  const api = await setup(t)
  process.env.SMTP_HOST = 'smtp.example.test'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_FROM = 'notifications@example.test'
  process.env.CONTACT_NOTIFICATION_EMAIL = 'inbox@example.test'
  api.transport.sendMail = async () => { throw new Error('credential=secret; provider accepted then reset') }
  const response = await api.request('POST', '/api/contact', undefined, {
    name: 'Visitor', email: 'visitor@example.test', message: 'Please call me',
  })
  assert.equal(response.status, 201)
  assert.deepEqual(response.data, { message: 'Your enquiry has been received.', received: true })
  const notification = api.records.get(CONTACT_ID).notification
  assert.equal(notification.status, 'failed')
  assert.equal(notification.lastError, 'delivery_uncertain')
  assert.doesNotMatch(JSON.stringify(response.data), /credential|secret|provider/)
  const ownerDetail = await api.request('GET', `/api/contact/${CONTACT_ID}`, api.token())
  assert.equal(ownerDetail.status, 200)
  assert.equal(ownerDetail.data.notification.lastError, 'delivery_uncertain')
  assert.doesNotMatch(JSON.stringify(ownerDetail.data), /credential|secret|provider/)
})

test('invalid submissions and unknown fields are rejected without persistence', async t => {
  const api = await setup(t)
  assert.throws(() => parseContactSubmission({
    name: 'Visitor', email: 'visitor@example.test', message: 'Hello', source: 'property',
    propertyId: PROPERTY_ID, propertyUrl: 'https://attacker.example.test/listings/attacker',
  }))
  const invalid = [
    {},
    { name: 'Visitor', email: 'bad-email', message: 'Hello' },
    { name: ' ', email: 'visitor@example.test', message: 'Hello' },
    { name: 'Visitor', email: 'visitor@example.test', message: ' ' },
    { name: 'Visitor', email: 'visitor@example.test', message: 'Hello', source: 'other' },
    { name: 'Visitor', email: 'visitor@example.test', message: 'Hello', source: 'property' },
    { name: 'Visitor', email: 'visitor@example.test', message: 'Hello', source: 'property', propertyId: 'not-an-id' },
    { name: 'Visitor', email: 'visitor@example.test', message: 'Hello', propertyTitle: 'Spoofed title' },
    [],
  ]
  for (const body of invalid) assert.equal((await api.request('POST', '/api/contact', undefined, body)).status, 400)
  assert.equal(api.records.size, 0)
  assert.equal((await api.request('POST', '/api/contact', undefined, {
    name: 'Visitor', email: 'visitor@example.test', message: 'Hello', source: 'property', propertyId: '64b000000000000000000099',
  })).status, 404)
  assert.equal(api.records.size, 0)
})

test('owner inbox is private and authorized from current stored identity only', async t => {
  const legacy = { _id: CONTACT_ID, name: 'Legacy Visitor', email: 'legacy@example.test', message: 'Old record', createdAt: new Date('2026-11-18T10:00:00Z'), internal: 'not an API field' }
  const api = await setup(t, { initial: [legacy] })
  const routes = [
    ['GET', '/api/contact'],
    ['GET', `/api/contact/${CONTACT_ID}`],
    ['PATCH', `/api/contact/${CONTACT_ID}`, { status: 'read' }],
    ['POST', `/api/contact/${CONTACT_ID}/retry-notification`],
  ]
  for (const [method, path, body] of routes) assert.equal((await api.request(method, path, undefined, body)).status, 401)
  api.actor({ _id: 'actor', email: 'ordinary@example.test' })
  for (const [method, path, body] of routes) assert.equal((await api.request(method, path, api.token(), body)).status, 403)
  delete process.env.ADMIN_EMAILS
  assert.equal((await api.request('GET', '/api/contact', api.token())).status, 403)
  process.env.ADMIN_EMAILS = 'owner@example.test'
  api.actor({ _id: 'actor', email: 'OWNER@example.test' })
  const list = await api.request('GET', '/api/contact?page=1&limit=20', api.token())
  assert.equal(list.status, 200)
  assert.deepEqual(Object.keys(list.data).sort(), ['items', 'limit', 'page', 'pages', 'total'])
  assert.equal(list.data.total, 1)
  assert.equal(list.data.items[0].source, 'general')
  assert.equal(list.data.items[0].status, 'new')
  assert.deepEqual(Object.keys(list.data.items[0]).sort(), [
    '_id', 'name', 'email', 'message', 'phone', 'subject', 'interest', 'source', 'propertyId',
    'propertyTitle', 'propertyUrl', 'status', 'notification', 'createdAt',
  ].sort())
  assert.deepEqual(list.data.items[0].notification, {
    status: 'pending', attempts: 0, lastAttemptAt: null, lastError: null,
  })
  assert.equal(Object.hasOwn(list.data.items[0], 'internal'), false)
  assert.equal(list.data.items[0].email, 'legacy@example.test')
  assert.equal(api.records.get(CONTACT_ID).status, undefined, 'read compatibility must not persist defaults')
  const legacyDefaultsFilter = await api.request('GET', '/api/contact?status=new&source=general', api.token())
  assert.equal(legacyDefaultsFilter.status, 200)
  assert.equal(legacyDefaultsFilter.data.total, 1, 'missing legacy fields match read-time default filters')

  for (const [, path] of routes.slice(1, 2)) {
    const detail = await api.request('GET', path, api.token())
    assert.equal(detail.status, 200)
    assert.equal(detail.data.name, 'Legacy Visitor')
    assert.equal(Object.hasOwn(detail.data, 'internal'), false)
  }
  const updated = await api.request('PATCH', `/api/contact/${CONTACT_ID}`, api.token(), { status: 'read' })
  assert.equal(updated.status, 200)
  assert.equal(updated.data.status, 'read')
  assert.equal((await api.request('PATCH', `/api/contact/${CONTACT_ID}`, api.token(), { status: 'sent' })).status, 400)
})

test('inbox filters and pagination are validated and responses are no-store', async t => {
  const initial = [
    { _id: CONTACT_ID, name: 'A', email: 'a@example.test', message: 'one', createdAt: new Date('2026-11-18T10:00:00Z'), source: 'general', status: 'new' },
    { _id: PROPERTY_ID, name: 'B', email: 'b@example.test', message: 'two', createdAt: new Date('2026-11-19T10:00:00Z'), source: 'property', status: 'read' },
  ]
  const api = await setup(t, { initial })
  const token = api.token()
  const response = await api.request('GET', '/api/contact?page=1&limit=1&source=property&status=read', token)
  assert.equal(response.status, 200)
  assert.equal(response.data.total, 1)
  assert.equal(response.data.pages, 1)
  assert.equal(response.data.items[0].name, 'B')
  for (const path of ['/api/contact?page=0', '/api/contact?limit=101', '/api/contact?status=unknown', '/api/contact?source=all', '/api/contact?other=x']) {
    assert.equal((await api.request('GET', path, token)).status, 400)
  }
  const responseHeaders = await fetch(`http://127.0.0.1:${api.server.address().port}/api/contact`, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(responseHeaders.headers.get('cache-control'), 'no-store')
  const malformed = await fetch(`http://127.0.0.1:${api.server.address().port}/api/contact/${CONTACT_ID}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{',
  })
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { message: 'Invalid enquiry request' })
  assert.equal(malformed.headers.get('cache-control'), 'no-store')
})

test('retry claims are atomic, conflict while sending, and stop after five total attempts', async t => {
  const api = await setup(t, { initial: [{
    _id: CONTACT_ID, name: 'Retry Visitor', email: 'retry@example.test', message: 'Hello', source: 'general', status: 'new',
    notification: { status: 'failed', attempts: 1, lastError: 'smtp_not_configured' },
  }] })
  process.env.SMTP_HOST = 'smtp.example.test'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_FROM = 'notifications@example.test'
  process.env.CONTACT_NOTIFICATION_EMAIL = 'inbox@example.test'
  let sends = 0
  api.transport.sendMail = async () => { sends += 1; await new Promise(resolve => setTimeout(resolve, 10)); return { messageId: 'mock' } }
  const token = api.token()
  const results = await Promise.all([
    api.request('POST', `/api/contact/${CONTACT_ID}/retry-notification`, token),
    api.request('POST', `/api/contact/${CONTACT_ID}/retry-notification`, token),
  ])
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
  assert.equal(sends, 1)
  assert.equal(api.records.get(CONTACT_ID).notification.attempts, 2)
  api.records.get(CONTACT_ID).notification.attempts = 4
  api.records.get(CONTACT_ID).notification.status = 'failed'
  assert.equal((await api.request('POST', `/api/contact/${CONTACT_ID}/retry-notification`, token)).status, 200)
  assert.equal(api.records.get(CONTACT_ID).notification.attempts, 5)
  assert.equal((await api.request('POST', `/api/contact/${CONTACT_ID}/retry-notification`, token)).status, 409)
  assert.equal((await api.request('POST', `/api/contact/${CONTACT_ID}/retry-notification`, token, { status: 'sent' })).status, 400)
  assert.equal(api.records.get(CONTACT_ID).notification.attempts, 5)
})

test('expired notification lease can be recovered exactly once', async t => {
  const expired = new Date(Date.now() - 60_000)
  const api = await setup(t, { initial: [{
    _id: CONTACT_ID, name: 'Lease Visitor', email: 'lease@example.test', message: 'Hello', source: 'general', status: 'new',
    notification: { status: 'sending', attempts: 1, leaseToken: 'old-lease', leaseUntil: expired },
  }] })
  process.env.SMTP_HOST = 'smtp.example.test'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_FROM = 'notifications@example.test'
  process.env.CONTACT_NOTIFICATION_EMAIL = 'inbox@example.test'
  let sends = 0
  api.transport.sendMail = async () => {
    sends += 1
    await new Promise(resolve => setTimeout(resolve, 10))
    return { messageId: 'mock' }
  }
  const results = await Promise.all([
    api.request('POST', `/api/contact/${CONTACT_ID}/retry-notification`, api.token()),
    api.request('POST', `/api/contact/${CONTACT_ID}/retry-notification`, api.token()),
  ])
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
  assert.equal(sends, 1)
  assert.equal(api.records.get(CONTACT_ID).notification.attempts, 2)
  assert.equal(api.records.get(CONTACT_ID).notification.status, 'sent')
})

test('public contact submissions are rate limited per client IP without trusting forwarded headers by default', async t => {
  const api = await setup(t)
  assert.equal(api.app.get('trust proxy'), 0)
  const invalid = { name: 'Visitor', email: 'bad-email', message: 'Hello' }
  for (let index = 0; index < 10; index += 1) {
    assert.equal((await api.request('POST', '/api/contact', undefined, invalid)).status, 400)
  }
  const blocked = await fetch(`http://127.0.0.1:${api.server.address().port}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://frontend.example.test' },
    body: JSON.stringify(invalid),
  })
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers.get('access-control-allow-origin'), '*')
  assert.equal(blocked.headers.get('cache-control'), 'no-store')
  assert.match(blocked.headers.get('content-type'), /application\/json/)
  assert.deepEqual(await blocked.json(), { message: 'Too many enquiries. Please try again later.' })
})
