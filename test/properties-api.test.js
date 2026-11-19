import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import User from '../src/models/User.js'
import Property from '../src/models/Property.js'
import { serve, stub, query } from './helpers/http.js'

const validProperty = {
  title: '  Family home ',
  description: ' Bright and spacious ',
  price: 125000,
  location: '  Westlands, Nairobi  ',
  type: 'Apartment',
  bedrooms: 3,
  bathrooms: 2,
  area: 1200,
  featured: false,
  images: ['https://images.example.test/home.jpg'],
  features: ['Pool', 'Garden'],
}

const legacyProperty = {
  _id: '64b000000000000000000001',
  title: 'Legacy home',
  description: 'A pre-contract listing',
  price: 100000,
  type: 'Apartment',
  county: 'Kiambu',
  constituency: 'Ruiru',
  ward: 'Gitothua',
  features: ['Pool'],
  images: [],
}

const soldProperty = {
  ...legacyProperty,
  _id: '64b000000000000000000002',
  location: 'Ruiru, Kiambu',
  listingPurpose: 'sale',
  availability: 'sold',
  offerPercent: 0,
}

async function setup(t, currentUser = { _id: 'actor', email: 'owner@example.test' }) {
  const previous = { JWT_SECRET: process.env.JWT_SECRET, ADMIN_EMAILS: process.env.ADMIN_EMAILS }
  process.env.JWT_SECRET = 'local-property-api-test-secret'
  process.env.ADMIN_EMAILS = 'owner@example.test'
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      value === undefined ? delete process.env[key] : process.env[key] = value
    }
  })

  stub(t, User, 'findById', () => query(currentUser))
  const records = [legacyProperty, soldProperty]
  stub(t, Property, 'find', () => query(records))
  stub(t, Property, 'findById', id => query(records.find(property => property._id === id) ?? null))
  let created
  stub(t, Property, 'create', async data => {
    created = data
    const doc = new Property(data)
    await doc.validate()
    return doc
  })
  let saved = 0
  stub(t, Property.prototype, 'save', async function () {
    await this.validate()
    if (this.__v === undefined) assert.deepEqual(this.$where, { __v: { $exists: false } })
    saved += 1
    return this
  })

  const { default: app } = await import('../src/app.js')
  const api = await serve(app)
  t.after(api.close)
  return {
    ...api,
    token: jwt.sign({ userId: 'actor' }, process.env.JWT_SECRET),
    created: () => created,
    saved: () => saved,
  }
}

test('public property list and detail retain raw legacy semantics and project structured locations', async t => {
  const api = await setup(t)
  const list = await api.request('GET', '/api/properties')
  assert.equal(list.status, 200)
  const legacy = list.data.find(property => property._id === '64b000000000000000000001')
  assert.equal(legacy.location, 'Gitothua, Ruiru, Kiambu')
  assert.equal(legacy.effectivePrice, 100000)
  assert.equal(legacy.listingPurpose, 'sale')
  assert.equal(legacy.availability, 'available')
  assert.equal(legacy.offerPercent, 0)
  assert.equal(Object.hasOwn(legacyProperty, 'listingPurpose'), false)
  assert.equal(Object.hasOwn(legacyProperty, 'availability'), false)
  assert.equal(Object.hasOwn(legacyProperty, 'offerPercent'), false)

  const detail = await api.request('GET', '/api/properties/64b000000000000000000001')
  assert.equal(detail.status, 200)
  assert.equal(detail.data.location, 'Gitothua, Ruiru, Kiambu')
  assert.equal(detail.data.listingPurpose, 'sale')
  assert.equal(detail.data.availability, 'available')
  assert.equal(detail.data.offerPercent, 0)
  assert.equal(api.saved(), 0)
})

test('owner can create with existing frontend form fields and receives normalized contract defaults', async t => {
  const api = await setup(t)
  const anonymous = await api.request('POST', '/api/properties', undefined, validProperty)
  assert.equal(anonymous.status, 401)
  const created = await api.request('POST', '/api/properties', api.token, {
    ...validProperty,
    county: ' Nairobi ',
    constituency: ' Westlands ',
    ward: ' Parklands ',
    coordinates: [36.8, -1.2],
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  assert.equal(created.data.location, 'Westlands, Nairobi')
  assert.equal(created.data.title, 'Family home')
  assert.equal(created.data.listingPurpose, 'sale')
  assert.equal(created.data.availability, 'available')
  assert.equal(created.data.offerPercent, 0)
  assert.equal(created.data.effectivePrice, 125000)
  assert.deepEqual(created.data.features, ['Pool', 'Garden'])
  assert.equal(api.created().county, 'Nairobi')
  assert.deepEqual(api.created().coordinates, [36.8, -1.2])
})

test('owner create rejects unknown, derived and server-owned fields and invalid contract data', async t => {
  const api = await setup(t)
  for (const field of ['effectivePrice', 'listedBy', '_id', '__v', 'createdAt', 'updatedAt', 'purpose', 'unexpected']) {
    const response = await api.request('POST', '/api/properties', api.token, { ...validProperty, [field]: 'forged' })
    assert.equal(response.status, 400, field)
  }
  for (const changes of [
    { price: 0 },
    { price: '125000' },
    { offerPercent: 101 },
    { offerPercent: 1.234 },
    { listingPurpose: 'rent', type: 'Maisonette' },
    { listingPurpose: 'sale', availability: 'rented' },
    { location: '   ' },
  ]) {
    assert.equal((await api.request('POST', '/api/properties', api.token, { ...validProperty, ...changes })).status, 400)
  }
})

test('partial update merges raw existing data, validates the whole property, and saves through the model', async t => {
  const api = await setup(t)
  const response = await api.request('PUT', '/api/properties/64b000000000000000000002', api.token, {
    description: 'Updated legacy listing',
  })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.equal(api.saved(), 1)
  assert.equal(response.data.title, soldProperty.title)
  assert.equal(response.data.price, soldProperty.price)
  assert.equal(response.data.description, 'Updated legacy listing')
  assert.equal(response.data.availability, 'sold')

  const invalid = await api.request('PUT', '/api/properties/64b000000000000000000002', api.token, { price: -1 })
  assert.equal(invalid.status, 400)
  assert.equal(api.saved(), 1)
  const unknown = await api.request('PUT', '/api/properties/64b000000000000000000002', api.token, { effectivePrice: 1 })
  assert.equal(unknown.status, 400)
  assert.equal(api.saved(), 1)
})

test('partial updates of legacy records validate missing-field defaults without read-time writes', async t => {
  const api = await setup(t)
  const response = await api.request('PUT', '/api/properties/64b000000000000000000001', api.token, {
    description: 'Owner edited a legacy listing',
  })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.equal(response.data.location, 'Gitothua, Ruiru, Kiambu')
  assert.equal(response.data.listingPurpose, 'sale')
  assert.equal(response.data.availability, 'available')
  assert.equal(response.data.offerPercent, 0)
  assert.equal(api.saved(), 1)
})

test('changing listingPurpose must explicitly replace an incompatible legacy availability', async t => {
  const api = await setup(t)
  const omitted = await api.request('PUT', '/api/properties/64b000000000000000000002', api.token, { listingPurpose: 'rent' })
  assert.equal(omitted.status, 400)
  assert.equal(api.saved(), 0)

  const fixed = await api.request('PUT', '/api/properties/64b000000000000000000002', api.token, {
    listingPurpose: 'rent', availability: 'rented',
  })
  assert.equal(fixed.status, 200, JSON.stringify(fixed.data))
  assert.equal(fixed.data.listingPurpose, 'rent')
  assert.equal(fixed.data.availability, 'rented')
  assert.equal(api.saved(), 1)
})

test('property update remains owner-only', async t => {
  const api = await setup(t, { _id: 'actor', email: 'ordinary@example.test' })
  assert.equal((await api.request('PUT', '/api/properties/64b000000000000000000002', api.token, { description: 'No' })).status, 403)
  assert.equal((await api.request('PUT', '/api/properties/missing', api.token, { description: 'No' })).status, 403)
})

test('owner update returns 404 for absent records and 409 for stale saves', async t => {
  const api = await setup(t)
  assert.equal((await api.request('PUT', '/api/properties/64b000000000000000000099', api.token, { description: 'No' })).status, 404)
  stub(t, Property.prototype, 'save', async () => {
    const error = new Error('stale')
    error.name = 'VersionError'
    throw error
  })
  const response = await api.request('PUT', '/api/properties/64b000000000000000000002', api.token, { description: 'Changed' })
  assert.equal(response.status, 409)
  assert.equal(api.saved(), 0)
})
