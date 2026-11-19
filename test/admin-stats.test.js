import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import Property from '../src/models/Property.js'
import Contact from '../src/models/Contact.js'
import Blog from '../src/models/Blog.js'
import User from '../src/models/User.js'
import { serve, stub, query } from './helpers/http.js'

// Explicit model mocks; actual owner middleware and loopback HTTP.
test('active listing stats count available or missing legacy status, never featured or null', async t => {
  const previous = { JWT_SECRET: process.env.JWT_SECRET, ADMIN_EMAILS: process.env.ADMIN_EMAILS }
  process.env.JWT_SECRET = 'disposable-stats-test-secret'
  process.env.ADMIN_EMAILS = 'owner@example.test'
  t.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value })
  stub(t, User, 'findById', () => query({ _id: 'actor', email: 'owner@example.test' }))
  const filters = []
  stub(t, Property, 'countDocuments', async filter => { filters.push(filter); return filter.$or ? 3 : 9 })
  stub(t, Contact, 'countDocuments', async () => 7)
  stub(t, Blog, 'countDocuments', async () => 2)
  const { default: app } = await import('../src/app.js')
  const api = await serve(app); t.after(api.close)
  const token = jwt.sign({ userId: 'actor' }, process.env.JWT_SECRET)
  const result = await api.request('GET', '/api/admin/stats', token)
  assert.equal(result.status, 200)
  assert.equal(result.data.totals.activeListings, 3)
  assert.equal(result.data.totals.inquiries, 7)
  assert.equal(result.data.totals.properties, 9)
  const availableFilters = filters.filter(filter => filter.$or)
  assert.equal(availableFilters.length, 3)
  for (const filter of availableFilters) {
    assert.deepEqual(filter.$or, [{ availability: 'available' }, { availability: { $exists: false } }])
    assert.equal(Object.hasOwn(filter, 'featured'), false)
  }
})
