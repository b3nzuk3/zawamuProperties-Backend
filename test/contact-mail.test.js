import test from 'node:test'
import assert from 'node:assert/strict'
import nodemailer from 'nodemailer'
import Contact from '../src/models/Contact.js'
import { sendContactNotification, sendPropertyAlert, sendPropertyAlerts } from '../src/utils/emailService.js'
import { stub } from './helpers/http.js'

// Nodemailer transport is mocked; these tests never contact a real SMTP server.
const mailEnv = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'CONTACT_NOTIFICATION_EMAIL', 'FRONTEND_URL', 'NODE_ENV', 'EMAIL_FROM']

function configureContactMail() {
  process.env.SMTP_HOST = 'smtp.example.test'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_USER = 'smtp-user'
  process.env.SMTP_PASSWORD = 'smtp-password'
  process.env.SMTP_FROM = 'Zawamu enquiries <enquiries@example.test>'
  process.env.CONTACT_NOTIFICATION_EMAIL = 'owner@example.test'
  process.env.FRONTEND_URL = 'https://www.zawamu.test'
}

function preserveEnv(t) {
  const previous = Object.fromEntries(mailEnv.map(key => [key, process.env[key]]))
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value
  })
}

test('contact mail uses configured SMTP, trusted recipient, sender and visitor replyTo with escaped HTML', async t => {
  preserveEnv(t)
  configureContactMail()
  let transportOptions
  let mail
  stub(t, nodemailer, 'createTransport', options => {
    transportOptions = options
    return { sendMail: async options => { mail = options; return { messageId: 'mock-message' } } }
  })
  const result = await sendContactNotification({
    name: '<script>alert(1)</script> & visitor',
    email: 'visitor@example.test',
    phone: '+254700000001',
    message: '<img src=x onerror=alert(1)>\nHello',
    subject: 'Viewing <now>',
    interest: 'Apartment & land',
    source: 'property',
    propertyId: '64b000000000000000000002',
    propertyTitle: 'Stored <title>',
    propertyUrl: 'https://www.zawamu.test/listings/64b000000000000000000002',
  })
  assert.deepEqual(result, { success: true, messageId: 'mock-message' })
  assert.deepEqual(transportOptions, {
    host: 'smtp.example.test', port: 587, secure: false,
    auth: { user: 'smtp-user', pass: 'smtp-password' },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
  })
  assert.equal(mail.from, 'Zawamu enquiries <enquiries@example.test>')
  assert.equal(mail.to, 'owner@example.test')
  assert.equal(mail.replyTo, 'visitor@example.test')
  assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; visitor/)
  assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(mail.html, /Stored &lt;title&gt;/)
  assert.doesNotMatch(mail.html, /<script>|<img src=x/)
  assert.match(mail.text, /<img src=x onerror=alert\(1\)>/)
})

test('property mail preserves fields from a real Mongoose contact document', async t => {
  preserveEnv(t)
  configureContactMail()
  let mail
  stub(t, nodemailer, 'createTransport', () => ({ sendMail: async options => {
    mail = options
    return { messageId: 'document-fixture' }
  } }))
  // Real document hydration, mocked SMTP only; no database connection.
  const contact = Contact.hydrate({
    name: 'Document visitor', email: 'visitor@example.test', message: 'Document message',
    source: 'property', propertyId: '64b000000000000000000002',
    propertyTitle: 'Document <title>', propertyUrl: null,
  })
  assert.deepEqual(await sendContactNotification(contact), { success: true, messageId: 'document-fixture' })
  assert.equal(mail.replyTo, 'visitor@example.test')
  assert.equal(mail.subject, 'New property enquiry')
  assert.match(mail.html, /Document &lt;title&gt;/)
  assert.match(mail.text, /https:\/\/www.zawamu.test\/listings\/64b000000000000000000002/)
  assert.equal(contact.propertyUrl, null)
})

test('missing SMTP never reports development success or attempts a send', async t => {
  preserveEnv(t)
  process.env.NODE_ENV = 'development'
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'CONTACT_NOTIFICATION_EMAIL']) delete process.env[key]
  let transports = 0
  stub(t, nodemailer, 'createTransport', () => { transports += 1; return { sendMail: async () => ({ messageId: 'must-not-send' }) } })
  const result = await sendContactNotification({
    name: 'Visitor', email: 'visitor@example.test', message: 'Hello', source: 'general',
  })
  assert.deepEqual(result, { success: false, errorCode: 'notification_not_configured' })
  assert.equal(transports, 0)
})

test('SMTP delivery exceptions are converted to a safe error without exposing provider diagnostics', async t => {
  preserveEnv(t)
  configureContactMail()
  stub(t, nodemailer, 'createTransport', () => ({ sendMail: async () => { throw new Error('secret password smtp-auth failed') } }))
  const result = await sendContactNotification({
    name: 'Visitor', email: 'visitor@example.test', message: 'Hello', source: 'general',
  })
  assert.deepEqual(result, { success: false, errorCode: 'delivery_uncertain' })
  assert.doesNotMatch(JSON.stringify(result), /secret password|smtp-auth/)
})

test('property mail refuses invalid trusted public URLs and legacy alert exports remain callable', async t => {
  preserveEnv(t)
  configureContactMail()
  let sends = 0
  stub(t, nodemailer, 'createTransport', () => ({ sendMail: async () => { sends += 1; return { messageId: 'mock' } } }))
  for (const frontendUrl of [undefined, 'http://untrusted.example.test', 'https://www.zawamu.test/untrusted-path']) {
    if (frontendUrl === undefined) delete process.env.FRONTEND_URL
    else process.env.FRONTEND_URL = frontendUrl
    const result = await sendContactNotification({
      name: 'Visitor', email: 'visitor@example.test', message: 'Hello', source: 'property',
      propertyId: '64b000000000000000000002', propertyTitle: 'Stored title', propertyUrl: null,
    })
    assert.deepEqual(result, { success: false, errorCode: 'notification_not_configured' })
  }
  assert.equal(sends, 0)
  assert.equal(typeof sendPropertyAlert, 'function')
  assert.equal(typeof sendPropertyAlerts, 'function')
})
