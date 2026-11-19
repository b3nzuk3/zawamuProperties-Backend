import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import User from '../src/models/User.js'
import { serve, stub, query } from './helpers/http.js'

async function setup(t) {
  const previous = { JWT_SECRET: process.env.JWT_SECRET, ADMIN_EMAILS: process.env.ADMIN_EMAILS }
  process.env.JWT_SECRET = 'feature-api-test-secret-not-for-deployment'
  process.env.ADMIN_EMAILS = 'owner@example.test'
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      value === undefined ? delete process.env[key] : process.env[key] = value
    }
  })

  let actor = { _id: 'actor', email: 'owner@example.test' }
  stub(t, User, 'findById', id => {
    assert.equal(id, 'actor')
    if (actor instanceof Error) throw actor
    return query(actor)
  })

  const { default: app } = await import('../src/app.js')
  const api = await serve(app)
  t.after(api.close)

  // The feature model methods below are mocked; requests use real Express,
  // JWT middleware, and a loopback HTTP server without connecting to MongoDB.
  return {
    ...api,
    Feature: mongoose.models.Feature,
    actor: value => { actor = value },
    token: claims => jwt.sign({ userId: 'actor', ...claims }, process.env.JWT_SECRET),
  }
}

function stubFeature(t, api, method, implementation) {
  if (api.Feature) stub(t, api.Feature, method, implementation)
}

test('public feature catalog returns a stable nameKey-sorted list using mocked storage', async t => {
  const api = await setup(t)
  const unsorted = [
    { _id: 'feature-z', name: 'Zinc', nameKey: 'zinc' },
    { _id: 'feature-a', name: 'Almond', nameKey: 'almond' },
  ]
  let observedSort
  stubFeature(t, api, 'find', filter => {
    assert.deepEqual(filter ?? {}, {})
    const result = query(unsorted)
    result.sort = specification => {
      observedSort = specification
      return query([...unsorted].sort((left, right) =>
        left.nameKey.localeCompare(right.nameKey) || String(left._id).localeCompare(String(right._id)),
      ))
    }
    return result
  })

  const response = await api.request('GET', '/api/features')
  assert.equal(response.status, 200)
  assert.deepEqual(response.data, [
    { _id: 'feature-a', name: 'Almond' },
    { _id: 'feature-z', name: 'Zinc' },
  ])
  assert.deepEqual(observedSort, { nameKey: 1, _id: 1 })
})

test('feature schema has timestamps and a unique nameKey index', async t => {
  const api = await setup(t)
  assert.ok(api.Feature, 'Feature model is registered')
  assert.equal(api.Feature.schema.options.timestamps, true)
  assert.equal(api.Feature.schema.path('name').isRequired, true)
  assert.equal(api.Feature.schema.path('nameKey').isRequired, true)
  assert.ok(api.Feature.schema.indexes().some(([keys, options]) =>
    keys.nameKey === 1 && options.unique === true,
  ))

  const normalized = new api.Feature({ name: '  Garden\tPatio ', nameKey: 'spoofed' })
  await normalized.validate()
  assert.equal(normalized.name, 'Garden Patio')
  assert.equal(normalized.nameKey, 'garden patio')
})

test('shared feature name helper trims, collapses whitespace, lowercases keys, and enforces 100 characters', async () => {
  const { MAX_FEATURE_NAME_LENGTH, normalizeFeatureName } = await import('../src/utils/featureRules.js')
  assert.equal(MAX_FEATURE_NAME_LENGTH, 100)
  assert.deepEqual(normalizeFeatureName('  Swimming\t\n Pool  '), {
    name: 'Swimming Pool',
    nameKey: 'swimming pool',
  })
  assert.throws(() => normalizeFeatureName(42), /string/)
  assert.throws(() => normalizeFeatureName(' \t '), /required/)
  assert.throws(() => normalizeFeatureName('x'.repeat(MAX_FEATURE_NAME_LENGTH + 1)), /100/)
})

test('only a persisted allowlisted owner can create a feature', async t => {
  const api = await setup(t)
  let created
  stubFeature(t, api, 'findOne', async filter => {
    assert.deepEqual(filter, { nameKey: 'swimming pool' })
    return null
  })
  stubFeature(t, api, 'create', async values => {
    created = values
    return { _id: 'feature-new', ...values }
  })

  assert.equal((await api.request('POST', '/api/features', undefined, { name: 'Pool' })).status, 401)

  api.actor({ _id: 'actor', email: 'ordinary@example.test' })
  assert.equal((await api.request('POST', '/api/features', api.token({ isAdmin: true }), {
    name: 'Pool',
  })).status, 403)

  api.actor({ _id: 'actor', email: ' OWNER@Example.Test ' })
  const response = await api.request('POST', '/api/features', api.token({}), {
    name: '  Swimming\t Pool  ',
  })
  assert.equal(response.status, 201)
  assert.deepEqual(created, { name: 'Swimming Pool', nameKey: 'swimming pool' })
  assert.deepEqual(response.data, { _id: 'feature-new', name: 'Swimming Pool' })
})

test('owner creation fails closed when ADMIN_EMAILS is absent', async t => {
  const api = await setup(t)
  delete process.env.ADMIN_EMAILS
  let writes = 0
  stubFeature(t, api, 'create', async () => { writes += 1 })
  api.actor({ _id: 'actor', email: 'owner@example.test' })

  const response = await api.request('POST', '/api/features', api.token({ isAdmin: true }), {
    name: 'Garden',
  })
  assert.equal(response.status, 403)
  assert.equal(writes, 0)
})

test('case and whitespace-equivalent creation returns the existing feature', async t => {
  const api = await setup(t)
  const existing = { _id: 'feature-existing', name: 'Garden Patio', nameKey: 'garden patio' }
  let creates = 0
  stubFeature(t, api, 'findOne', async filter => {
    assert.deepEqual(filter, { nameKey: 'garden patio' })
    return existing
  })
  stubFeature(t, api, 'create', async () => { creates += 1 })

  const response = await api.request('POST', '/api/features', api.token({}), {
    name: '  gARDEN\t Patio  ',
  })
  assert.equal(response.status, 200)
  assert.deepEqual(response.data, { _id: 'feature-existing', name: 'Garden Patio' })
  assert.equal(creates, 0)
})

test('duplicate-key creation race rereads and returns the winning feature', async t => {
  const api = await setup(t)
  const winner = { _id: 'feature-winner', name: 'Balcony', nameKey: 'balcony' }
  let lookups = 0
  let creates = 0
  stubFeature(t, api, 'findOne', async filter => {
    assert.deepEqual(filter, { nameKey: 'balcony' })
    lookups += 1
    return lookups === 1 ? null : winner
  })
  stubFeature(t, api, 'create', async () => {
    creates += 1
    const error = new Error('duplicate key')
    error.code = 11000
    error.keyPattern = { nameKey: 1 }
    throw error
  })

  const response = await api.request('POST', '/api/features', api.token({}), { name: 'BALCONY' })
  assert.equal(response.status, 200)
  assert.deepEqual(response.data, { _id: 'feature-winner', name: 'Balcony' })
  assert.equal(lookups, 2)
  assert.equal(creates, 1)
})

test('invalid and unknown feature input is rejected before storage access', async t => {
  const api = await setup(t)
  let databaseCalls = 0
  stubFeature(t, api, 'findOne', async () => { databaseCalls += 1 })
  stubFeature(t, api, 'create', async () => { databaseCalls += 1 })
  const inputs = [
    ['empty name', { name: '' }],
    ['whitespace-only name', { name: ' \t\n ' }],
    ['overlong name', { name: 'x'.repeat(101) }],
    ['non-string name', { name: 12 }],
    ['missing name', { displayName: 'Pool' }],
    ['unknown field', { name: 'Pool', nameKey: 'pool' }],
    ['array body', []],
  ]

  for (const [label, body] of inputs) {
    const response = await api.request('POST', '/api/features', api.token({}), body)
    assert.equal(response.status, 400, label)
  }
  assert.equal(databaseCalls, 0)
})

test('feature read and write storage failures return generic server errors', async t => {
  const api = await setup(t)
  stubFeature(t, api, 'find', () => {
    const result = query([])
    result.sort = async () => { throw new Error('private storage diagnostic') }
    return result
  })
  assert.deepEqual(await api.request('GET', '/api/features'), {
    status: 500,
    data: { message: 'Unable to load features' },
  })

  stubFeature(t, api, 'findOne', async () => null)
  stubFeature(t, api, 'create', async () => { throw new Error('private storage diagnostic') })
  const write = await api.request('POST', '/api/features', api.token({}), { name: 'Garden' })
  assert.deepEqual(write, { status: 500, data: { message: 'Unable to save feature' } })
})

test('feature catalog exposes no rename or delete routes', async t => {
  const api = await setup(t)
  for (const [method, path] of [
    ['PUT', '/api/features'],
    ['DELETE', '/api/features'],
    ['PUT', '/api/features/feature-id'],
    ['DELETE', '/api/features/feature-id'],
  ]) {
    assert.equal((await api.request(method, path, api.token({}), {})).status, 404, `${method} ${path}`)
  }
})
