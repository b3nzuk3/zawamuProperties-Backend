// Real HTTP + MongoDB acceptance. Never reads .env or uses MONGODB_URI.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const uri = process.env.TEST_MONGODB_URI
if (!uri) throw new Error('TEST_MONGODB_URI is required; production MONGODB_URI is never used')
const target = new URL(uri)
if (
  target.protocol !== 'mongodb:' ||
  target.hostname !== '127.0.0.1' ||
  target.username || target.password || target.search || target.hash ||
  !/^\/zawamu_phase_a_[a-z0-9_]+$/.test(target.pathname)
) throw new Error('Use a credential-free loopback MongoDB URI with database prefix zawamu_phase_a_')

const keepServing = process.argv.includes('--serve')
let credentialsFile = process.env.PHASE_A_FIXTURE_FILE
if (keepServing && !credentialsFile) throw new Error('--serve requires PHASE_A_FIXTURE_FILE outside the repository')
if (keepServing) {
  if (!isAbsolute(credentialsFile)) {
    throw new Error('PHASE_A_FIXTURE_FILE must be an absolute path outside the repository')
  }
  const repository = await realpath(fileURLToPath(new URL('../', import.meta.url)))
  // Resolve parent symlinks once, then write the canonical path, not the alias.
  credentialsFile = join(await realpath(dirname(credentialsFile)), basename(credentialsFile))
  const location = relative(repository, credentialsFile)
  if (location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location)) {
    throw new Error('PHASE_A_FIXTURE_FILE must be an absolute path outside the repository')
  }
}
const ownerEmail = 'phase-a-owner@example.test'
const memberEmail = 'phase-a-member@example.test'
const password = randomBytes(24).toString('base64url')
process.env.JWT_SECRET = randomBytes(48).toString('hex')
process.env.ADMIN_EMAILS = `  ${ownerEmail.toUpperCase()}  `
// Do not let model initialization create collections before the empty-DB guard.
mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)

const { default: app } = await import('../src/app.js')
const { default: User } = await import('../src/models/User.js')
const { default: Property } = await import('../src/models/Property.js')
const { default: Contact } = await import('../src/models/Contact.js')
const { default: ViewingRequest } = await import('../src/models/ViewingRequest.js')
let server
let assertions = 0
const verify = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1 }
const jsonRequest = async (path, { token, method = 'GET', body } = {}) => {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, data }
}
let origin
let cleaned = false
let ownsDatabase = false
const cleanup = async () => {
  if (cleaned) return
  cleaned = true
  try {
    if (server) await new Promise((resolve) => server.close(resolve))
    // Ownership begins only after discovery proves the disposable database empty.
    if (ownsDatabase && mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase()
  } finally {
    await mongoose.disconnect()
  }
}

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
  // Refuse an existing nonempty test database instead of deleting someone else's fixtures.
  const existing = await mongoose.connection.db.listCollections().toArray()
  if (existing.length) {
    throw new Error('Disposable database is not empty; choose a fresh unique database name')
  }
  ownsDatabase = true
  const hash = await bcrypt.hash(password, 10)
  const [owner, member] = await User.create([
    { name: 'Phase A Owner', email: ownerEmail, password: hash },
    { name: 'Phase A Member', email: memberEmail, password: hash },
  ])
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = `http://127.0.0.1:${server.address().port}`
  verify(await jsonRequest('/'), { status: 200, data: 'Zawamu Properties API is running' })
  verify((await jsonRequest('/api/auth/register', { method: 'POST', body: { name: 'No Registration' } })).status, 404)
  verify((await jsonRequest('/api/auth/login', { method: 'POST', body: { email: ownerEmail, password: `${password}-wrong` } })).status, 401)

  const ownerLogin = await jsonRequest('/api/auth/login', { method: 'POST', body: { email: ownerEmail, password } })
  const memberLogin = await jsonRequest('/api/auth/login', { method: 'POST', body: { email: memberEmail, password } })
  verify(ownerLogin.status, 200)
  verify(memberLogin.status, 200)
  verify(ownerLogin.data.user.isAdmin, true)
  verify(memberLogin.data.user.isAdmin, false)
  verify(Object.keys(ownerLogin.data.user).sort(), ['email', 'id', 'isAdmin', 'name'])
  const ownerToken = ownerLogin.data.token
  const memberToken = memberLogin.data.token
  const ownerProfile = await jsonRequest('/api/auth/profile', { token: ownerToken })
  verify(ownerProfile.data, ownerLogin.data.user)

  const propertyId = new mongoose.Types.ObjectId().toString()
  const deniedRoutes = [
    ['POST', '/api/properties'], ['PUT', `/api/properties/${propertyId}`], ['DELETE', `/api/properties/${propertyId}`],
    ['GET', '/api/admin/stats'], ['GET', '/api/admin/recent-activity'],
    ['GET', '/api/viewing-requests'], ['GET', `/api/viewing-requests/${propertyId}`],
    ['PUT', `/api/viewing-requests/${propertyId}`], ['DELETE', `/api/viewing-requests/${propertyId}`],
    ['POST', '/api/upload'], ['GET', '/api/analytics'],
    ['POST', '/api/blog'], ['PUT', `/api/blog/${propertyId}`], ['DELETE', `/api/blog/${propertyId}`],
    ['GET', '/api/saved-searches/admin/check-matches'],
  ]
  for (const [method, path] of deniedRoutes) {
    verify((await jsonRequest(path, { method })).status, 401)
    verify((await jsonRequest(path, { method, token: memberToken })).status, 403)
  }
  const spoof = jwt.sign({ userId: member.id, email: ownerEmail, isAdmin: true }, process.env.JWT_SECRET)
  verify((await jsonRequest('/api/admin/stats', { token: spoof })).status, 403)

  const created = await jsonRequest('/api/properties', { method: 'POST', token: ownerToken, body: {
    title: 'Phase A disposable property', description: 'Acceptance fixture, not production inventory',
    price: 5000000, location: 'Fixture ward, Fixture constituency, Fixture county',
    county: 'Fixture county', constituency: 'Fixture constituency', ward: 'Fixture ward', type: 'Apartment',
  } })
  verify(created.status, 201)
  const id = created.data._id
  verify((await Property.findById(id)).title, 'Phase A disposable property')
  verify((await jsonRequest('/api/properties')).data.length, 1)
  verify((await jsonRequest(`/api/properties/${id}`)).status, 200)
  verify((await jsonRequest(`/api/properties/${id}`, { method: 'PUT', token: ownerToken, body: { title: 'Phase A edited fixture' } })).status, 200)
  verify((await Property.findById(id)).title, 'Phase A edited fixture')
  verify((await jsonRequest('/api/admin/stats', { token: ownerToken })).status, 200)
  verify((await jsonRequest('/api/admin/recent-activity', { token: ownerToken })).status, 200)
  verify((await jsonRequest('/api/analytics', { token: ownerToken })).status, 200)
  verify((await jsonRequest('/api/upload', { method: 'POST', token: ownerToken, body: {} })).status, 400)
  verify((await jsonRequest('/api/blog')).status, 200)

  verify((await jsonRequest('/api/contact', { method: 'POST', body: { name: 'Fixture Visitor', email: 'visitor@example.test', message: 'Phase A public contact persistence' } })).status, 201)
  verify(await Contact.countDocuments({ message: 'Phase A public contact persistence' }), 1)
  const viewing = await jsonRequest('/api/viewing-requests', { method: 'POST', body: {
    propertyId: id, propertyTitle: 'Phase A edited fixture', name: 'Fixture Visitor', email: 'visitor@example.test',
    preferredDate: new Date(Date.now() + 86400000).toISOString(), preferredTime: '10:00', message: 'Disposable viewing request',
  } })
  verify(viewing.status, 201)
  const viewingId = viewing.data.viewingRequest._id
  verify((await jsonRequest('/api/viewing-requests', { token: ownerToken })).data.length, 1)
  verify((await jsonRequest(`/api/viewing-requests/${viewingId}`, { method: 'PUT', token: ownerToken, body: { status: 'confirmed', notes: 'Acceptance fixture' } })).status, 200)
  verify((await ViewingRequest.findById(viewingId)).status, 'confirmed')

  await User.updateOne({ _id: owner.id }, { email: 'revoked-owner@example.test' })
  verify((await jsonRequest('/api/admin/stats', { token: ownerToken })).status, 403)
  await User.updateOne({ _id: owner.id }, { email: ownerEmail })
  const [deleted] = await User.create([{ name: 'Deleted fixture user', email: 'deleted@example.test', password: hash }])
  const deletedToken = jwt.sign({ userId: deleted.id }, process.env.JWT_SECRET)
  await User.deleteOne({ _id: deleted.id })
  verify((await jsonRequest('/api/admin/stats', { token: deletedToken })).status, 403)

  console.log(JSON.stringify({ passed: true, layer: 'real HTTP and disposable MongoDB', assertions, deniedRoutes: deniedRoutes.length }))
  if (keepServing) {
    await writeFile(credentialsFile, JSON.stringify({ apiOrigin: origin, ownerEmail, memberEmail, password, propertyId: id }), { mode: 0o600, flag: 'wx' })
    console.log(`Phase A disposable API ready at ${origin}; fixture credentials saved privately outside repository`)
    await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve) })
  }
} finally {
  await cleanup()
}
