import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import app from '../src/app.js'
import SavedSearch from '../src/models/SavedSearch.js'
import SavedSearchSession from '../src/models/SavedSearchSession.js'
import { serve, stub } from './helpers/http.js'

test('corrupt legacy criteria cannot be serialized as an unfiltered replay', async t => {
  const email = 'legacy@example.test'
  stub(t, SavedSearchSession, 'findOne', async () => ({ email, expiresAt: new Date(Date.now() + 60_000) }))
  stub(t, SavedSearch, 'findOne', async () => SavedSearch.hydrate({
    _id: '64b000000000000000000055', userEmail: email, userName: 'Legacy',
    name: 'Broken range', isActive: true, searchCriteria: { minPrice: 1000, maxPrice: 10 },
  }))
  const api = await serve(app)
  t.after(api.close)
  const response = await fetch(`http://127.0.0.1:${api.server.address().port}/api/saved-searches/64b000000000000000000055`, {
    headers: { 'X-Saved-Search-Session': randomBytes(32).toString('base64url') },
  })
  assert.equal(response.status, 200)
  const { data } = await response.json()
  assert.equal(data.searchCriteria, null)
  assert.equal(data.verifiedAt, null)
  assert.equal(data.alertConsentAt, null)
})

test('private search-list pagination never hides entries beyond the first bounded page', async t => {
  const email = 'pages@example.test'
  stub(t, SavedSearchSession, 'findOne', async () => ({ email, expiresAt: new Date(Date.now() + 60_000) }))
  let observedSkip
  let observedLimit
  stub(t, SavedSearch, 'find', filter => {
    assert.deepEqual(filter, { userEmail: email, isActive: true })
    return {
      sort() { return this },
      skip(value) { observedSkip = value; return this },
      limit(value) { observedLimit = value; return Promise.resolve([]) },
    }
  })
  stub(t, SavedSearch, 'countDocuments', async filter => {
    assert.deepEqual(filter, { userEmail: email, isActive: true })
    return 101
  })
  const api = await serve(app)
  t.after(api.close)
  const response = await fetch(`http://127.0.0.1:${api.server.address().port}/api/saved-searches?page=6&limit=20`, {
    headers: { 'X-Saved-Search-Session': randomBytes(32).toString('base64url') },
  })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(observedSkip, 100)
  assert.equal(observedLimit, 20)
  assert.deepEqual(result.pagination, {
    currentPage: 6, totalPages: 6, totalSearches: 101, hasNextPage: false, hasPrevPage: true,
  })
})
