import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import Property from '../src/models/Property.js'
import User from '../src/models/User.js'
import ViewingRequest from '../src/models/ViewingRequest.js'
import { serve, stub, query } from './helpers/http.js'

const propertyId = '64b000000000000000000001'
const availableProperty = {
  _id: propertyId,
  title: 'Persisted listing title',
  availability: 'available',
}
const viewingPayload = {
  propertyId,
  propertyTitle: 'Client supplied title',
  name: 'Visitor',
  email: 'visitor@example.test',
  phone: '0712345678',
  preferredDate: '2030-04-05',
  preferredTime: '10:00 AM',
  message: 'Please contact me.',
}

async function setup(t) {
  const previous = { JWT_SECRET: process.env.JWT_SECRET, ADMIN_EMAILS: process.env.ADMIN_EMAILS }
  process.env.JWT_SECRET = 'viewing-availability-test-secret'
  process.env.ADMIN_EMAILS = 'owner@example.test'
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      value === undefined ? delete process.env[key] : process.env[key] = value
    }
  })

  let property = availableProperty
  let actor = { _id: 'actor', email: 'owner@example.test' }
  const created = []
  let propertyLookups = 0
  stub(t, User, 'findById', () => query(actor))
  stub(t, Property, 'findById', id => {
    propertyLookups += 1
    return query(property && String(property._id) === String(id) ? property : null)
  })
  stub(t, ViewingRequest, 'create', async values => {
    created.push(values)
    return { _id: `viewing-${created.length}`, ...values }
  })
  stub(t, ViewingRequest, 'find', () => query([]))

  const { default: app } = await import('../src/app.js')
  const api = await serve(app)
  t.after(api.close)
  return {
    ...api,
    actor: value => { actor = value },
    property: value => { property = value },
    created: () => created,
    propertyLookups: () => propertyLookups,
    token: claims => jwt.sign({ userId: 'actor', ...claims }, process.env.JWT_SECRET),
  }
}

test('anonymous viewing submission stays public and saves the persisted property title', async t => {
  const api = await setup(t)

  const response = await api.request('POST', '/api/viewing-requests', undefined, viewingPayload)

  assert.equal(response.status, 201)
  assert.equal(api.created().length, 1)
  assert.equal(api.created()[0].propertyTitle, availableProperty.title)
  assert.equal(response.data.viewingRequest.propertyTitle, availableProperty.title)
  assert.equal(Object.hasOwn(api.created()[0], 'availability'), false)
})

test('legacy properties with missing availability remain available for viewing', async t => {
  const api = await setup(t)
  api.property({ _id: propertyId, title: 'Legacy listing without availability' })

  const response = await api.request('POST', '/api/viewing-requests', undefined, viewingPayload)

  assert.equal(response.status, 201)
  assert.equal(api.created().length, 1)
  assert.equal(api.created()[0].propertyTitle, 'Legacy listing without availability')
})

test('sold and rented properties return a clear conflict without creating a viewing', async t => {
  const api = await setup(t)

  for (const availability of ['sold', 'rented']) {
    api.property({ ...availableProperty, availability })
    const response = await api.request('POST', '/api/viewing-requests', undefined, viewingPayload)
    assert.equal(response.status, 409, availability)
    assert.match(response.data.message, new RegExp(availability, 'i'))
    assert.match(response.data.message, /viewing/i)
  }

  assert.equal(api.created().length, 0)
})

test('unknown or missing property references return 404 without saving', async t => {
  const api = await setup(t)
  api.property(null)
  const unknown = await api.request('POST', '/api/viewing-requests', undefined, {
    ...viewingPayload,
    propertyId: '64b000000000000000000099',
  })
  const missing = await api.request('POST', '/api/viewing-requests', undefined, {
    ...viewingPayload,
    propertyId: undefined,
  })

  assert.equal(unknown.status, 404)
  assert.equal(missing.status, 404)
  assert.equal(api.created().length, 0)
  assert.equal(api.propertyLookups(), 1)
})

test('unknown and explicit null availability fail closed without creating a viewing', async t => {
  const api = await setup(t)
  for (const availability of [null, 'withdrawn', '']) {
    api.property({ ...availableProperty, availability })
    const response = await api.request('POST', '/api/viewing-requests', undefined, viewingPayload)
    assert.equal(response.status, 409)
    assert.match(response.data.message, /not available for viewings/i)
  }
  assert.equal(api.created().length, 0)
})

test('viewing management remains restricted to the persisted configured owner', async t => {
  const api = await setup(t)

  assert.equal((await api.request('GET', '/api/viewing-requests')).status, 401)
  api.actor({ _id: 'actor', email: 'ordinary@example.test' })
  assert.equal((await api.request('GET', '/api/viewing-requests', api.token({ isAdmin: true }))).status, 403)
  api.actor({ _id: 'actor', email: ' owner@example.test ' })
  assert.deepEqual(await api.request('GET', '/api/viewing-requests', api.token({})), {
    status: 200,
    data: [],
  })
})
