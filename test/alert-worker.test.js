import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { getNairobiDayStart, isCadenceDue } from '../src/utils/alertCadence.js'
import SavedSearchSchemaModel from '../src/models/SavedSearch.js'
import AlertDeliverySchemaModel from '../src/models/AlertDelivery.js'
import AlertLeaseSchemaModel from '../src/models/AlertLease.js'
import { runSavedSearchAlerts } from '../src/services/savedSearchAlerts.js'
import { main as runAlertsCli } from '../scripts/run-saved-search-alerts.mjs'

function query(value) {
  const result = Promise.resolve(value)
  for (const method of ['sort', 'limit', 'select', 'lean']) result[method] = () => result
  return result
}

function cursorQuery(values) {
  return {
    sort() { return this },
    select() { return this },
    cursor(options) {
      this.options = options
      return (async function * () { for (const value of values) yield value })()
    },
  }
}

function validSearch(fields = {}) {
  return {
    _id: '64b000000000000000000001',
    userEmail: 'guest@example.test',
    userName: 'Guest',
    name: 'Homes',
    searchCriteria: {},
    alertSettings: { isActive: true, frequency: 'immediate', maxAlertsPerDay: 5 },
    isActive: true,
    createdAt: new Date('2026-11-20T00:00:00.000Z'),
    verifiedAt: new Date('2026-11-01T00:00:00.000Z'),
    alertConsentAt: new Date('2026-11-01T00:00:00.000Z'),
    ...fields,
  }
}

function validProperty(fields = {}) {
  return {
    _id: '64b000000000000000000101',
    createdAt: new Date('2026-11-02T00:00:00.000Z'),
    title: 'Home',
    description: 'A home',
    price: 100_000,
    type: 'Apartment',
    location: 'Nairobi',
    availability: 'available',
    listingPurpose: 'sale',
    offerPercent: 0,
    ...fields,
  }
}

function dryRunModels(search = validSearch(), property = validProperty()) {
  const writes = []
  const queries = {}
  const forbiddenWrite = name => async () => { writes.push(name); throw new Error(`unexpected ${name}`) }
  const models = {
    SavedSearch: {
      find(filter) { queries.searchFilter = filter; return query([search]) },
      updateOne: forbiddenWrite('SavedSearch.updateOne'),
    },
    Property: {
      find(filter) {
        queries.propertyFilter = filter
        return cursorQuery([property])
      },
    },
    AlertDelivery: {
      find(filter) { queries.deliveryFilter = filter; return query([]) },
      aggregate() { return query([]) },
      insertMany: forbiddenWrite('AlertDelivery.insertMany'),
      updateMany: forbiddenWrite('AlertDelivery.updateMany'),
      updateOne: forbiddenWrite('AlertDelivery.updateOne'),
    },
    AlertLease: {
      findOne(filter) { queries.leaseReadFilter = filter; return query(null) },
      findOneAndUpdate: forbiddenWrite('AlertLease.findOneAndUpdate'),
      updateOne: forbiddenWrite('AlertLease.updateOne'),
    },
  }
  return { models, writes, queries }
}

test('Africa/Nairobi daily cadence is due exactly at 09:00 and independent of host timezone', () => {
  const previousSlot = new Date('2026-11-22T06:00:00.000Z') // Sunday 09:00 EAT
  assert.equal(isCadenceDue('daily', previousSlot, new Date('2026-11-23T05:59:59.999Z')), false)
  assert.equal(isCadenceDue('daily', previousSlot, new Date('2026-11-23T06:00:00.000Z')), true)
  assert.equal(isCadenceDue('daily', new Date('2026-11-23T06:00:00.000Z'), new Date('2026-11-23T06:00:00.000Z')), false)
  assert.equal(isCadenceDue('daily', null, new Date('2026-11-23T05:59:59.999Z')), false)
  assert.equal(isCadenceDue('daily', null, new Date('2026-11-23T06:00:00.000Z')), true)
})

test('Africa/Nairobi weekly cadence uses Monday 09:00 across the year boundary', () => {
  const previousMonday = new Date('2025-12-29T06:00:00.000Z')
  assert.equal(isCadenceDue('weekly', previousMonday, new Date('2026-01-05T05:59:59.999Z')), false)
  assert.equal(isCadenceDue('weekly', previousMonday, new Date('2026-01-05T06:00:00.000Z')), true)
  assert.equal(isCadenceDue('weekly', new Date('2026-01-05T06:00:00.000Z'), new Date('2026-01-05T06:00:00.000Z')), false)
  assert.equal(isCadenceDue('weekly', null, new Date('2026-01-04T12:00:00.000Z')), false)
  assert.equal(isCadenceDue('immediate', null, new Date('2026-01-04T12:00:00.000Z')), true)
})

test('Nairobi day quota boundary is stable at UTC midnight and local 09:00', () => {
  assert.equal(getNairobiDayStart(new Date('2026-11-23T05:59:59.999Z')).toISOString(), '2026-11-22T21:00:00.000Z')
  assert.equal(getNairobiDayStart(new Date('2026-11-23T06:00:00.000Z')).toISOString(), '2026-11-22T21:00:00.000Z')
  assert.equal(getNairobiDayStart(new Date('2026-11-24T00:00:00.000Z')).toISOString(), '2026-11-23T21:00:00.000Z')
})

test('worker rejects invalid execution options before touching models', async () => {
  let modelCalls = 0
  const models = { AlertLease: { findOne() { modelCalls += 1 } } }
  for (const options of [
    { execute: 'true' },
    { now: '2026-11-23' },
    { now: new Date(Number.NaN) },
    { batchSize: 0 },
    { batchSize: 101 },
    { batchSize: 1.5 },
  ]) {
    await assert.rejects(runSavedSearchAlerts({ ...options, models }))
  }
  assert.equal(modelCalls, 0)
})

test('default worker run is read-only dry-run and filters out searches lacking verified consent', async () => {
  const search = validSearch()
  const property = validProperty()
  const { models, writes, queries } = dryRunModels(search, property)
  let sends = 0

  const summary = await runSavedSearchAlerts({
    now: new Date('2026-11-23T12:00:00.000Z'),
    models,
    sendPropertyAlert: async () => { sends += 1; return { success: true } },
    env: { SAVED_SEARCH_ALERTS_ENABLED: 'true' },
  })

  assert.equal(summary.dryRun, true)
  assert.equal(summary.checkedSearches, 1)
  assert.deepEqual(queries.searchFilter, {
    isActive: true,
    'alertSettings.isActive': true,
    verifiedAt: { $type: 'date' },
    alertConsentAt: { $type: 'date' },
  })
  assert.deepEqual(queries.propertyFilter.createdAt, { $gte: search.alertConsentAt })
  assert.equal(writes.length, 0)
  assert.equal(sends, 0)
})

test('execute requires exact enablement plus validated SMTP sender and trusted frontend origin', async () => {
  let sends = 0
  for (const env of [
    { ...mailEnvironment, SAVED_SEARCH_ALERTS_ENABLED: 'false' },
    { ...mailEnvironment, FRONTEND_URL: 'http://untrusted.example.test' },
  ]) {
    const { models, writes } = dryRunModels()
    const summary = await runSavedSearchAlerts({
      execute: true,
      now: new Date('2026-11-23T12:00:00.000Z'),
      models,
      sendPropertyAlert: async () => { sends += 1; return { success: true } },
      env,
    })
    assert.equal(summary.disabled, true)
    assert.equal(summary.dryRun, true)
    assert.equal(writes.length, 0)
  }
  assert.equal(sends, 0)
})

const mailEnvironment = {
  SAVED_SEARCH_ALERTS_ENABLED: 'true',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_FROM: 'Alerts <alerts@example.test>',
  FRONTEND_URL: 'https://www.zawamu.test',
}

function pathValue(object, path) {
  return path.split('.').reduce((current, part) => current?.[part], object)
}

function matchesFilter(document, filter) {
  return Object.entries(filter ?? {}).every(([key, expected]) => {
    if (key === '$or') return expected.some(branch => matchesFilter(document, branch))
    const actual = pathValue(document, key)
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      return Object.entries(expected).every(([operator, operand]) => {
        if (operator === '$type') return operand === 'date' ? actual instanceof Date : typeof actual === operand
        if (operator === '$exists') return operand ? actual !== undefined : actual === undefined
        if (operator === '$in') return operand.some(value => value === actual || (value === null && actual === undefined))
        if (operator === '$ne') return actual !== operand
        if (operator === '$gt') return actual > operand
        if (operator === '$gte') return actual >= operand
        if (operator === '$lt') return actual < operand
        if (operator === '$lte') return actual <= operand
        return false
      })
    }
    return actual === expected
  })
}

function applyUpdate(document, update) {
  for (const [field, value] of Object.entries(update.$set ?? {})) {
    const parts = field.split('.')
    let parent = document
    for (const part of parts.slice(0, -1)) parent = parent[part] ??= {}
    parent[parts.at(-1)] = value
  }
  for (const [field, value] of Object.entries(update.$inc ?? {})) {
    document[field] = (document[field] ?? 0) + value
  }
}

function memoryQuery(getValues) {
  let sortSpec = null
  let maximum = Infinity
  const queryObject = {
    sort(spec) { sortSpec = spec; return this },
    limit(value) { maximum = value; return this },
    select() { return this },
    lean() { return this },
    cursor(options) {
      const values = getValues(sortSpec, maximum)
      queryObject.cursorOptions = options
      return (async function * () { for (const value of values) yield value })()
    },
    then(resolve, reject) {
      return Promise.resolve(getValues(sortSpec, maximum)).then(resolve, reject)
    },
  }
  return queryObject
}

function memoryModels({ searches = [validSearch()], properties = [validProperty()], deliveries = [], leases = [] } = {}) {
  let sequence = 0
  const cursorBatches = []
  const propertyFilters = []
  const indexEvents = []
  const list = (values, filter, sort, maximum = Infinity) => {
    let result = values.filter(value => matchesFilter(value, filter))
    if (sort) {
      const [[field, direction]] = Object.entries(sort)
      result = result.sort((a, b) => {
        const left = pathValue(a, field)
        const right = pathValue(b, field)
        return left === right ? 0 : (left < right ? -1 : 1) * direction
      })
    }
    return result.slice(0, maximum)
  }
  const writeOne = (values, filter, update) => {
    const found = values.find(value => matchesFilter(value, filter))
    if (!found) return { matchedCount: 0, modifiedCount: 0 }
    applyUpdate(found, update)
    return { matchedCount: 1, modifiedCount: 1 }
  }
  const models = {
    SavedSearch: {
      find(filter) { return memoryQuery((sort, maximum) => list(searches, filter, sort, maximum)) },
      findOne(filter) { return memoryQuery(() => searches.find(search => matchesFilter(search, filter)) ?? null) },
      updateOne(filter, update) { return Promise.resolve(writeOne(searches, filter, update)) },
    },
    Property: {
      find(filter) {
        propertyFilters.push(filter)
        return memoryQuery((sort, maximum) => list(properties, filter, sort, maximum))
      },
    },
    AlertDelivery: {
      find(filter) { return memoryQuery((sort, maximum) => list(deliveries, filter, sort, maximum)) },
      findOne(filter) { return memoryQuery((sort, maximum) => list(deliveries, filter, sort, maximum)[0] ?? null) },
      async createIndexes() { indexEvents.push('AlertDelivery.createIndexes') },
      async insertMany(documents) {
        for (const document of documents) {
          if (deliveries.some(row => row.savedSearchId === document.savedSearchId && row.propertyId === document.propertyId)) {
            const error = new Error('duplicate key')
            error.code = 11000
            throw error
          }
          deliveries.push({ _id: `delivery-${++sequence}`, ...document })
        }
        return documents
      },
      async updateMany(filter, update) {
        const found = deliveries.filter(row => matchesFilter(row, filter))
        for (const row of found) applyUpdate(row, update)
        return { matchedCount: found.length, modifiedCount: found.length }
      },
      async updateOne(filter, update) { return writeOne(deliveries, filter, update) },
      async aggregate(pipeline) {
        const filter = pipeline[0].$match
        const groups = new Set(deliveries.filter(row => matchesFilter(row, filter)).map(row => row.batchKey))
        return groups.size ? [{ count: groups.size }] : []
      },
    },
    AlertLease: {
      findOne(filter) { return memoryQuery(() => leases.find(lease => matchesFilter(lease, filter)) ?? null) },
      async createIndexes() { indexEvents.push('AlertLease.createIndexes') },
      async findOneAndUpdate(filter, update, options) {
        indexEvents.push('AlertLease.findOneAndUpdate')
        let found = leases.find(lease => matchesFilter(lease, filter))
        if (!found && options.upsert) {
          const key = filter.searchId ? 'searchId' : 'workerKey'
          const keyValue = filter[key]
          const collision = leases.find(lease => lease[key] === keyValue)
          if (collision) {
            const error = new Error('duplicate key')
            error.code = 11000
            throw error
          }
          found = { _id: `lease-${++sequence}`, [key]: keyValue, lastSearchId: null }
          leases.push(found)
        }
        if (!found || !matchesFilter(found, filter)) return null
        applyUpdate(found, update)
        return found
      },
      async updateOne(filter, update) { return writeOne(leases, filter, update) },
    },
  }
  const propertyFind = models.Property.find
  models.Property.find = filter => {
    const queryObject = propertyFind(filter)
    const originalCursor = queryObject.cursor
    queryObject.cursor = options => {
      cursorBatches.push(options.batchSize)
      return originalCursor(options)
    }
    return queryObject
  }
  return { models, searches, properties, deliveries, leases, cursorBatches, propertyFilters, indexEvents }
}

test('execute persists pair ledger before one digest, updates counters, and deduplicates repeat invocation', async () => {
  const search = validSearch()
  const property = validProperty()
  const fixture = memoryModels({ searches: [search], properties: [property] })
  let sends = 0
  const options = {
    execute: true,
    now: new Date('2026-11-23T12:00:00.000Z'),
    clock: () => new Date('2026-11-23T12:00:00.000Z'),
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async (savedSearch, properties) => {
      sends += 1
      assert.equal(savedSearch.userEmail, 'guest@example.test')
      assert.equal(properties.length, 1)
      assert.equal(fixture.deliveries[0].status, 'sending', 'intent is durable before SMTP')
      return { success: true, messageId: 'private-provider-id' }
    },
  }

  const first = await runSavedSearchAlerts(options)
  const second = await runSavedSearchAlerts(options)

  assert.equal(first.sentMessages, 1)
  assert.equal(first.dryRun, false)
  assert.equal(second.sentMessages, 0)
  assert.equal(sends, 1)
  assert.equal(fixture.deliveries.length, 1)
  assert.equal(fixture.deliveries[0].status, 'sent')
  assert.equal(fixture.deliveries[0].errorCode, null)
  assert.equal(search.totalAlertsSent, 1)
  assert.equal(search.alertsSentToday, 1)
  assert.equal(search.lastAlertSent.toISOString(), '2026-11-23T12:00:00.000Z')
  assert.deepEqual(fixture.cursorBatches, [100, 100])
  assert.equal(JSON.stringify(first).includes('guest@example.test'), false)
  assert.equal(JSON.stringify(first).includes('private-provider-id'), false)
})

test('execute awaits delivery and lease indexes before claiming any lease or sending', async () => {
  const fixture = memoryModels()
  const sends = []
  await runSavedSearchAlerts({
    execute: true,
    now: new Date('2026-11-23T12:00:00.000Z'),
    clock: () => new Date('2026-11-23T12:00:00.000Z'),
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async () => { sends.push('send'); return { success: true } },
  })
  assert.deepEqual(fixture.indexEvents.slice(0, 2), [
    'AlertDelivery.createIndexes',
    'AlertLease.createIndexes',
  ])
  assert.ok(fixture.indexEvents.indexOf('AlertLease.findOneAndUpdate') > 1)
  assert.deepEqual(sends, ['send'])
})

test('index build errors fail closed before an execute lease or SMTP transport', async () => {
  const fixture = memoryModels()
  let leaseClaims = 0
  let sends = 0
  fixture.models.AlertDelivery.createIndexes = async () => { throw new Error('private index diagnostic') }
  const findOneAndUpdate = fixture.models.AlertLease.findOneAndUpdate
  fixture.models.AlertLease.findOneAndUpdate = (...args) => {
    leaseClaims += 1
    return findOneAndUpdate(...args)
  }
  await assert.rejects(runSavedSearchAlerts({
    execute: true,
    now: new Date('2026-11-23T12:00:00.000Z'),
    clock: () => new Date('2026-11-23T12:00:00.000Z'),
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async () => { sends += 1; return { success: true } },
  }), /private index diagnostic/)
  assert.equal(leaseClaims, 0)
  assert.equal(sends, 0)
})

test('SMTP uncertainty becomes terminal unknown and never gets an automatic resend', async () => {
  const fixture = memoryModels()
  let sends = 0
  const options = {
    execute: true,
    now: new Date('2026-11-23T12:00:00.000Z'),
    clock: () => new Date('2026-11-23T12:00:00.000Z'),
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async () => { sends += 1; throw new Error('raw smtp diagnostic must not escape') },
  }
  const first = await runSavedSearchAlerts(options)
  const next = await runSavedSearchAlerts(options)
  assert.equal(first.unknownMessages, 1)
  assert.equal(next.sentMessages, 0)
  assert.equal(sends, 1)
  assert.equal(fixture.deliveries[0].status, 'unknown')
  assert.equal(fixture.deliveries[0].errorCode, 'delivery_uncertain')
  assert.equal(JSON.stringify(first).includes('raw smtp'), false)
})

test('definite configuration failure is backoff-limited to three attempts', async () => {
  const fixture = memoryModels()
  let current = new Date('2026-11-23T12:00:00.000Z')
  let sends = 0
  const options = {
    execute: true,
    now: current,
    clock: () => current,
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async () => { sends += 1; return { success: false, error: 'notification_not_configured' } },
  }
  await runSavedSearchAlerts(options)
  assert.equal(fixture.deliveries[0].status, 'failed')
  assert.equal(fixture.deliveries[0].attempts, 1)
  assert.equal(fixture.deliveries[0].nextAttemptAt.toISOString(), '2026-11-23T12:01:00.000Z')
  await runSavedSearchAlerts(options)
  assert.equal(sends, 1, 'backoff blocks immediate retry')

  for (const gap of [61_000, 601_000]) {
    current = new Date(current.getTime() + gap)
    options.now = current
    await runSavedSearchAlerts(options)
  }
  assert.equal(sends, 3)
  assert.equal(fixture.deliveries[0].attempts, 3)
  assert.equal(fixture.deliveries[0].nextAttemptAt, null)
  current = new Date(current.getTime() + 24 * 60 * 60 * 1000)
  options.now = current
  await runSavedSearchAlerts(options)
  assert.equal(sends, 3, 'attempt cap remains terminal')
})

test('lease recovery marks abandoned sending batches unknown and skips another send in that pass', async () => {
  const search = validSearch()
  const property = validProperty()
  const fixture = memoryModels({
    searches: [search],
    properties: [property],
    deliveries: [{
      _id: 'stale-delivery',
      savedSearchId: search._id,
      propertyId: property._id,
      status: 'sending',
      batchKey: 'old-batch',
      leaseToken: 'old-token',
      attempts: 1,
      sentAt: null,
    }],
    leases: [{
      _id: 'search-lease', searchId: search._id, leaseToken: 'old-token',
      expiresAt: new Date('2026-11-23T11:00:00.000Z'),
    }],
  })
  let sends = 0
  const summary = await runSavedSearchAlerts({
    execute: true,
    now: new Date('2026-11-23T12:00:00.000Z'),
    clock: () => new Date('2026-11-23T12:00:00.000Z'),
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async () => { sends += 1; return { success: true } },
  })
  assert.equal(summary.unknownMessages, 1)
  assert.equal(sends, 0)
  assert.equal(fixture.deliveries[0].status, 'unknown')
})

test('unavailable or pre-consent properties are excluded by bounded cursor and rechecked before transport', async () => {
  const search = validSearch()
  const consentAt = search.alertConsentAt
  const fixtures = memoryModels({
    searches: [search],
    properties: [
      validProperty({ _id: '64b000000000000000000101', createdAt: new Date(consentAt.getTime() - 1) }),
      validProperty({ _id: '64b000000000000000000102', availability: 'sold' }),
      validProperty({ _id: '64b000000000000000000103', availability: null }),
      validProperty({ _id: '64b000000000000000000104', availability: undefined }),
    ],
  })
  let sentIds = []
  const summary = await runSavedSearchAlerts({
    execute: true,
    now: new Date('2026-11-23T12:00:00.000Z'),
    clock: () => new Date('2026-11-23T12:00:00.000Z'),
    env: mailEnvironment,
    models: fixtures.models,
    sendPropertyAlert: async (_search, properties) => {
      sentIds = properties.map(property => property._id)
      return { success: true }
    },
  })
  assert.equal(summary.sentMessages, 1)
  assert.deepEqual(sentIds, ['64b000000000000000000104'])
  assert.equal(fixtures.deliveries.length, 1)
  assert.deepEqual(fixtures.propertyFilters[0].createdAt, { $gte: consentAt })
})

test('missing or non-date verification and consent never reach the worker query results', async () => {
  const verified = validSearch({ _id: '64b000000000000000000001' })
  const legacy = validSearch({
    _id: '64b000000000000000000002',
    verifiedAt: undefined,
    alertConsentAt: undefined,
  })
  const invalid = validSearch({
    _id: '64b000000000000000000003',
    verifiedAt: '2026-11-01',
    alertConsentAt: new Date('2026-11-01T00:00:00.000Z'),
  })
  const fixture = memoryModels({ searches: [verified, legacy, invalid] })
  const result = await runSavedSearchAlerts({
    now: new Date('2026-11-23T12:00:00.000Z'),
    models: fixture.models,
    env: {},
  })
  assert.equal(result.checkedSearches, 1)
  assert.equal(result.potentialMessages, 1)
  assert.equal(fixture.deliveries.length, 0)
})

test('round-robin search cursor continues beyond the first bounded worker batch', async () => {
  const searches = [1, 2, 3].map(n => validSearch({
    _id: `64b00000000000000000000${n}`,
    userEmail: `guest${n}@example.test`,
  }))
  const fixture = memoryModels({ searches, properties: [validProperty()] })
  const sentTo = []
  const options = {
    execute: true,
    batchSize: 1,
    now: new Date('2026-11-23T12:00:00.000Z'),
    clock: () => new Date('2026-11-23T12:00:00.000Z'),
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async search => { sentTo.push(search.userEmail); return { success: true } },
  }
  const runs = []
  for (let index = 0; index < searches.length; index += 1) runs.push(await runSavedSearchAlerts(options))
  assert.deepEqual(sentTo, ['guest1@example.test', 'guest2@example.test', 'guest3@example.test'])
  assert.ok(runs[0].continuation)
  assert.ok(runs[1].continuation)
  assert.equal(fixture.deliveries.length, 3)
})

test('digest cap leaves additional matches queued for later invocations', async () => {
  const search = validSearch()
  const properties = Array.from({ length: 130 }, (_, index) => validProperty({
    _id: `64b000000000000000${String(index + 100).padStart(4, '0')}`,
    title: `Home ${index + 1}`,
  }))
  const fixture = memoryModels({ searches: [search], properties })
  const digestSizes = []
  const options = {
    execute: true,
    now: new Date('2026-11-23T12:00:00.000Z'),
    clock: () => new Date('2026-11-23T12:00:00.000Z'),
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async (_search, listings) => { digestSizes.push(listings.length); return { success: true } },
  }
  await runSavedSearchAlerts(options)
  assert.deepEqual(digestSizes, [50])
  assert.equal(fixture.deliveries.length, 100)
  assert.equal(fixture.deliveries.filter(row => row.status === 'sent').length, 50)
  assert.equal(fixture.deliveries.filter(row => row.status === 'queued').length, 50)
  await runSavedSearchAlerts(options)
  await runSavedSearchAlerts(options)
  assert.deepEqual(digestSizes, [50, 50, 30])
  assert.equal(fixture.deliveries.length, 130)
  assert.ok(fixture.deliveries.every(row => row.status === 'sent'))
})

test('Nairobi daily message quota blocks extra immediate digests until the next local day', async () => {
  const search = validSearch({ alertSettings: { isActive: true, frequency: 'immediate', maxAlertsPerDay: 1 } })
  const firstProperty = validProperty()
  const secondProperty = validProperty({ _id: '64b000000000000000000102', title: 'New listing' })
  const fixture = memoryModels({ searches: [search], properties: [firstProperty] })
  let current = new Date('2026-11-23T12:00:00.000Z')
  let sends = 0
  const options = {
    execute: true,
    now: current,
    clock: () => current,
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async () => { sends += 1; return { success: true } },
  }
  await runSavedSearchAlerts(options)
  fixture.properties.push(secondProperty)
  current = new Date('2026-11-23T15:00:00.000Z')
  options.now = current
  await runSavedSearchAlerts(options)
  assert.equal(sends, 1)
  assert.equal(fixture.deliveries.length, 1)
  current = new Date('2026-11-23T21:00:00.000Z')
  options.now = current
  await runSavedSearchAlerts(options)
  assert.equal(sends, 2)
  assert.equal(fixture.deliveries.length, 2)
})

test('Nairobi daily quota counts an uncertain digest until the next local day', async () => {
  const search = validSearch({ alertSettings: { isActive: true, frequency: 'immediate', maxAlertsPerDay: 1 } })
  const fixture = memoryModels({ searches: [search], properties: [validProperty()] })
  let current = new Date('2026-11-23T12:00:00.000Z')
  let sends = 0
  const options = {
    execute: true,
    now: current,
    clock: () => current,
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async () => { sends += 1; throw new Error('SMTP acknowledgement lost') },
  }
  await runSavedSearchAlerts(options)
  assert.equal(fixture.deliveries[0].status, 'unknown')

  fixture.properties.push(validProperty({ _id: '64b000000000000000000102', title: 'New listing' }))
  current = new Date('2026-11-23T20:59:59.999Z')
  options.now = current
  await runSavedSearchAlerts(options)
  assert.equal(sends, 1, 'unknown delivery consumes the Nairobi-day quota')
  assert.equal(fixture.deliveries.length, 1)

  current = new Date('2026-11-23T21:00:00.000Z')
  options.now = current
  await runSavedSearchAlerts(options)
  assert.equal(sends, 2, 'quota resets at Nairobi midnight')
  assert.equal(fixture.deliveries.length, 2)
})

for (const cadenceCase of [
  { frequency: 'daily', nextBoundary: '2026-11-24T06:00:00.000Z' },
  { frequency: 'weekly', nextBoundary: '2026-11-30T06:00:00.000Z' },
]) {
  test(`${cadenceCase.frequency} cadence advances on unknown delivery attempts`, async () => {
    const search = validSearch({
      alertSettings: { isActive: true, frequency: cadenceCase.frequency, maxAlertsPerDay: 5 },
    })
    const fixture = memoryModels({ searches: [search], properties: [validProperty()] })
    let current = new Date('2026-11-23T12:00:00.000Z')
    let sends = 0
    const options = {
      execute: true,
      now: current,
      clock: () => current,
      env: mailEnvironment,
      models: fixture.models,
      sendPropertyAlert: async () => {
        sends += 1
        if (sends === 1) throw new Error('SMTP acknowledgement lost')
        return { success: true }
      },
    }
    await runSavedSearchAlerts(options)
    fixture.properties.push(validProperty({ _id: '64b000000000000000000102', title: 'New listing' }))

    current = new Date('2026-11-23T13:00:00.000Z')
    options.now = current
    await runSavedSearchAlerts(options)
    assert.equal(sends, 1, 'the ambiguous attempt establishes the next cadence boundary')

    current = new Date(cadenceCase.nextBoundary)
    options.now = current
    await runSavedSearchAlerts(options)
    assert.equal(sends, 2)
    assert.equal(fixture.deliveries.find(row => row.propertyId === '64b000000000000000000102').status, 'sent')
  })
}

test('definite configuration failures do not advance a daily cadence boundary', async () => {
  const search = validSearch({ alertSettings: { isActive: true, frequency: 'daily', maxAlertsPerDay: 5 } })
  const fixture = memoryModels({ searches: [search] })
  let current = new Date('2026-11-23T12:00:00.000Z')
  let sends = 0
  const options = {
    execute: true,
    now: current,
    clock: () => current,
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async () => {
      sends += 1
      return sends === 1 ? { success: false, error: 'notification_not_configured' } : { success: true }
    },
  }
  await runSavedSearchAlerts(options)
  current = new Date('2026-11-23T12:01:01.000Z')
  options.now = current
  await runSavedSearchAlerts(options)
  assert.equal(sends, 2)
  assert.equal(fixture.deliveries[0].status, 'sent')
})

test('a slow in-flight run holds the global fence so another invocation cannot send concurrently', async () => {
  const fixture = memoryModels()
  let sendStarted
  let finishSend
  const started = new Promise(resolve => { sendStarted = resolve })
  const pendingSend = new Promise(resolve => { finishSend = resolve })
  let sends = 0
  const options = {
    execute: true,
    now: new Date('2026-11-23T12:00:00.000Z'),
    clock: () => new Date('2026-11-23T12:00:00.000Z'),
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async () => { sends += 1; sendStarted(); await pendingSend; return { success: true } },
  }
  const firstRun = runSavedSearchAlerts(options)
  await started
  const overlappingRun = await runSavedSearchAlerts(options)
  assert.equal(overlappingRun.skipped, 1)
  assert.equal(overlappingRun.sentMessages, 0)
  assert.equal(sends, 1)
  finishSend()
  const first = await firstRun
  assert.equal(first.sentMessages, 1)
})

test('SMTP success followed by ledger persistence failure is unknown, never resent', async () => {
  const fixture = memoryModels()
  const ordinaryUpdateMany = fixture.models.AlertDelivery.updateMany
  fixture.models.AlertDelivery.updateMany = async (filter, update) => {
    if (update.$set?.status === 'sent') throw new Error('private database error')
    return ordinaryUpdateMany(filter, update)
  }
  let sends = 0
  const options = {
    execute: true,
    now: new Date('2026-11-23T12:00:00.000Z'),
    clock: () => new Date('2026-11-23T12:00:00.000Z'),
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async () => { sends += 1; return { success: true } },
  }
  const first = await runSavedSearchAlerts(options)
  const retry = await runSavedSearchAlerts(options)
  assert.equal(first.unknownMessages, 1)
  assert.equal(fixture.deliveries[0].status, 'unknown')
  assert.equal(retry.sentMessages, 0)
  assert.equal(sends, 1)
})

test('a listing made unavailable between scan and SMTP recheck is not delivered', async () => {
  const fixture = memoryModels()
  const ordinaryFind = fixture.models.Property.find
  let calls = 0
  fixture.models.Property.find = filter => {
    calls += 1
    if (calls === 2) fixture.properties[0].availability = 'sold'
    return ordinaryFind(filter)
  }
  let sends = 0
  const summary = await runSavedSearchAlerts({
    execute: true,
    now: new Date('2026-11-23T12:00:00.000Z'),
    clock: () => new Date('2026-11-23T12:00:00.000Z'),
    env: mailEnvironment,
    models: fixture.models,
    sendPropertyAlert: async () => { sends += 1; return { success: true } },
  })
  assert.equal(summary.sentMessages, 0)
  assert.equal(sends, 0)
  assert.equal(fixture.deliveries[0].status, 'failed')
  assert.equal(fixture.deliveries[0].errorCode, 'listing_unavailable')
})

test('saved-search worker schema has typed consent dates and unique durable deduplication indexes', () => {
  assert.equal(SavedSearchSchemaModel.schema.path('verifiedAt').instance, 'Date')
  assert.equal(SavedSearchSchemaModel.schema.path('verifiedAt').options.immutable, undefined)
  assert.equal(SavedSearchSchemaModel.schema.path('alertConsentAt').instance, 'Date')
  assert.equal(SavedSearchSchemaModel.schema.path('userEmail').options.immutable, true)
  const firstStamp = new Date('2026-11-23T12:00:00.000Z')
  const pendingUpdate = SavedSearchSchemaModel.findOneAndUpdate(
    { _id: '64b000000000000000000001', userEmail: 'visitor@example.test' },
    { $set: { verifiedAt: firstStamp, alertConsentAt: firstStamp } },
    { new: true, runValidators: true },
  )
  const castUpdate = pendingUpdate._castUpdate(pendingUpdate.getUpdate())
  assert.equal(castUpdate.$set.verifiedAt.getTime(), firstStamp.getTime())
  assert.equal(castUpdate.$set.alertConsentAt.getTime(), firstStamp.getTime())
  const deliveryIndexes = AlertDeliverySchemaModel.schema.indexes()
  assert.ok(deliveryIndexes.some(([keys, options]) =>
    keys.savedSearchId === 1 && keys.propertyId === 1 && options.unique === true
  ))
  const leaseIndexes = AlertLeaseSchemaModel.schema.indexes()
  assert.ok(leaseIndexes.some(([keys, options]) => keys.searchId === 1 && options.unique === true && options.sparse === true))
  assert.ok(leaseIndexes.some(([keys, options]) => keys.workerKey === 1 && options.unique === true && options.sparse === true))
})

test('worker CLI help is offline and never requires or reveals a MongoDB URI', () => {
  const result = spawnSync(process.execPath, ['scripts/run-saved-search-alerts.mjs', '--help'], {
    cwd: process.cwd(),
    env: { ...process.env, MONGODB_URI: 'mongodb://sensitive.example.test/private' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /read-only dry-run/)
  assert.doesNotMatch(result.stdout, /sensitive\.example\.test|private/)
  const missing = spawnSync(process.execPath, ['scripts/run-saved-search-alerts.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, MONGODB_URI: '' },
    encoding: 'utf8',
  })
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /requires inherited MONGODB_URI/)
  assert.doesNotMatch(missing.stderr, /sensitive|mongodb:\/\//)
})

test('worker CLI disables collection auto-creation in dry-run and disconnects after failed connection', async () => {
  const calls = []
  const mongo = {
    set(name, value) { calls.push(['set', name, value]) },
    async connect(uri, options) {
      calls.push(['connect', uri, options])
    },
    async disconnect() { calls.push(['disconnect']) },
  }
  const model = name => ({
    async createIndexes() { calls.push([name, 'createIndexes']) },
    async init() { calls.push([name, 'init']) },
  })
  let workerOptions
  const code = await runAlertsCli([], { MONGODB_URI: 'mongodb://127.0.0.1/zawamu_alerts_test' }, {
    mongooseClient: mongo,
    models: { SavedSearch: model('SavedSearch'), AlertDelivery: model('AlertDelivery'), AlertLease: model('AlertLease') },
    runWorker: async options => { workerOptions = options; return { dryRun: true } },
    stdout: { write(value) { calls.push(['stdout', value]) } },
    stderr: { write(value) { calls.push(['stderr', value]) } },
  })
  assert.equal(code, 0)
  assert.deepEqual(calls.find(call => call[0] === 'connect'), [
    'connect',
    'mongodb://127.0.0.1/zawamu_alerts_test',
    { autoCreate: false, autoIndex: false },
  ])
  assert.ok(calls.some(call => call[0] === 'set' && call[1] === 'autoCreate' && call[2] === false))
  assert.ok(calls.some(call => call[0] === 'set' && call[1] === 'autoIndex' && call[2] === false))
  assert.equal(calls.some(call => call[1] === 'createIndexes' || call[1] === 'init'), false)
  assert.equal(workerOptions.execute, false)
  assert.deepEqual(calls.at(-2), ['stdout', '{"dryRun":true}\n'])
  assert.deepEqual(calls.at(-1), ['disconnect'])

  const failedCalls = []
  const failedMongo = {
    set() {},
    async connect() { failedCalls.push('connect'); throw new Error('private connection diagnostic') },
    async disconnect() { failedCalls.push('disconnect') },
  }
  const failedCode = await runAlertsCli([], { MONGODB_URI: 'mongodb://127.0.0.1/zawamu_alerts_test' }, {
    mongooseClient: failedMongo,
    models: {},
    runWorker: async () => { failedCalls.push('worker'); return {} },
    stdout: { write() {} },
    stderr: { write(value) { failedCalls.push(value) } },
  })
  assert.equal(failedCode, 1)
  assert.deepEqual(failedCalls.slice(0, 2), ['connect', 'disconnect'])
  assert.equal(failedCalls.includes('worker'), false)
  assert.match(failedCalls[2], /failed \(database_connect\)/)
  assert.doesNotMatch(failedCalls[2], /private connection diagnostic|mongodb:\/\//)
})
