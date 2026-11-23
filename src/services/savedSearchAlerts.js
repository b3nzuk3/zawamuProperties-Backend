import { randomUUID } from 'node:crypto'
import SavedSearchModel from '../models/SavedSearch.js'
import PropertyModel from '../models/Property.js'
import AlertDeliveryModel from '../models/AlertDelivery.js'
import AlertLeaseModel from '../models/AlertLease.js'
import { sendPropertyAlert as defaultSendPropertyAlert } from '../utils/emailService.js'
import { getTrustedFrontendOrigin } from '../utils/contactRules.js'
import { getSmtpConfiguration } from '../utils/smtpTransport.js'
import { matchesSavedSearchProperty } from '../utils/savedSearchRules.js'
import { serializeProperty } from '../utils/propertyRules.js'
import { getNairobiDayStart, isCadenceDue } from '../utils/alertCadence.js'

const WORKER_KEY = 'saved-search-alerts-v1'
const WORKER_LEASE_MS = 2 * 60 * 1000 // > configured 30s SMTP socket timeout; renewed while a digest is in flight.
const SEARCH_SCAN_MULTIPLIER = 10
const MAX_SEARCH_SCAN = 1000
const PROPERTY_CURSOR_BATCH = 100
const MAX_LISTINGS_PER_DIGEST = 50
const MAX_DELIVERY_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [60 * 1000, 10 * 60 * 1000]
const SEARCH_FIELDS = '_id userEmail userName name searchCriteria alertSettings isActive verifiedAt alertConsentAt createdAt lastAlertSent totalAlertsSent alertsSentToday lastAlertResetDate'
const PROPERTY_FIELDS = '_id title description price type location county constituency ward coordinates listingPurpose availability offerPercent featured images bedrooms bathrooms area createdAt'
const ACTIVE_CONSENT_FILTER = Object.freeze({
  isActive: true,
  'alertSettings.isActive': true,
  verifiedAt: { $type: 'date' },
  alertConsentAt: { $type: 'date' },
})

function isDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function validConsent(search, now) {
  return isDate(search?.verifiedAt) && isDate(search?.alertConsentAt) &&
    search.verifiedAt.getTime() <= now.getTime() && search.alertConsentAt.getTime() <= now.getTime()
}

function assertOptions({ execute, now, batchSize, env, clock }) {
  if (typeof execute !== 'boolean') throw new TypeError('execute must be a boolean')
  if (!isDate(now)) throw new TypeError('now must be a valid Date')
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new TypeError('batchSize must be an integer from 1 to 100')
  }
  if (env === null || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('env must be an object')
  if (typeof clock !== 'function') throw new TypeError('clock must be a function')
}

function clockDate(clock) {
  const value = clock()
  if (!isDate(value)) throw new TypeError('clock must return a valid Date')
  return value
}

function queryMethod(query, method, ...args) {
  return typeof query?.[method] === 'function' ? query[method](...args) : query
}

function safeInteger(value, fallback, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback
}

function isDuplicateKey(error) {
  return error?.code === 11000 || error?.writeErrors?.every(writeError => writeError?.code === 11000)
}

function matchedCount(result) {
  return result?.matchedCount ?? result?.n ?? 0
}

function modificationCount(result) {
  return result?.modifiedCount ?? result?.nModified ?? 0
}

function smtpReady(env, getSmtp, getOrigin) {
  const smtp = getSmtp(env)
  const sender = typeof smtp?.from === 'string' && smtp.from.trim()
    ? smtp.from.trim()
    : typeof env.EMAIL_FROM === 'string' && env.EMAIL_FROM.trim()
      ? env.EMAIL_FROM.trim()
      : ''
  return Boolean(smtp && sender && getOrigin(typeof env.FRONTEND_URL === 'string' ? env.FRONTEND_URL : ''))
}

function summaryTemplate({ dryRun = true, disabled = false } = {}) {
  return {
    checkedSearches: 0,
    sentMessages: 0,
    unknownMessages: 0,
    skipped: 0,
    potentialMessages: 0,
    continuation: false,
    dryRun,
    disabled,
  }
}

function cursorSearchFilter(lastSearchId, direction) {
  if (!lastSearchId) return {}
  return { _id: { [direction === 'after' ? '$gt' : '$lte']: lastSearchId } }
}

async function boundedSearches(SavedSearch, lastSearchId, limit) {
  const read = async (direction, take) => {
    if (take < 1) return []
    let query = SavedSearch.find({ ...ACTIVE_CONSENT_FILTER, ...cursorSearchFilter(lastSearchId, direction) })
    query = queryMethod(query, 'sort', { _id: 1 })
    query = queryMethod(query, 'limit', take)
    query = queryMethod(query, 'select', SEARCH_FIELDS)
    query = queryMethod(query, 'lean')
    return await query
  }
  const after = await read('after', limit)
  if (!lastSearchId || after.length >= limit) return { searches: after, continuation: after.length >= limit }
  const before = await read('before', limit - after.length)
  return {
    searches: [...after, ...before],
    continuation: before.length >= limit - after.length,
  }
}

async function claimLease(AlertLease, query, token, now, ttlMs) {
  try {
    return await AlertLease.findOneAndUpdate(
      {
        ...query,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $lte: now } },
        ],
      },
      { $set: { leaseToken: token, expiresAt: new Date(now.getTime() + ttlMs) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  } catch (error) {
    if (isDuplicateKey(error)) return null
    throw error
  }
}

function startHeartbeat({ AlertLease, AlertDelivery, leaseFilter, token, clock, ttlMs, searchId }) {
  let lost = false
  let running = false
  let pending = null
  const renewNow = async () => {
    if (lost) return false
    const now = clockDate(clock)
    const expiresAt = new Date(now.getTime() + ttlMs)
    const result = await AlertLease.updateOne(
      { ...leaseFilter, leaseToken: token, expiresAt: { $gt: now } },
      { $set: { expiresAt } },
    )
    if (matchedCount(result) !== 1) {
      lost = true
      return false
    }
    if (searchId) {
      await AlertDelivery.updateMany(
        { savedSearchId: searchId, status: 'sending', leaseToken: token },
        { $set: { leaseExpiresAt: expiresAt } },
      )
    }
    return true
  }
  const timer = setInterval(() => {
    if (running || lost) return
    running = true
    pending = renewNow().catch(() => { lost = true }).finally(() => {
      running = false
      pending = null
    })
  }, Math.max(1000, Math.floor(ttlMs / 4)))
  timer.unref?.()
  return {
    renewNow,
    isLost: () => lost,
    async stop() {
      clearInterval(timer)
      if (pending) await pending
    },
  }
}

async function countAttemptedMessagesToday(AlertDelivery, savedSearchId, dayStart) {
  const rows = await AlertDelivery.aggregate([
    {
      $match: {
        savedSearchId,
        status: { $in: ['sent', 'unknown', 'sending'] },
        lastAttemptAt: { $gte: dayStart },
        batchKey: { $type: 'string' },
      },
    },
    { $group: { _id: '$batchKey' } },
    { $count: 'count' },
  ])
  return Number.isSafeInteger(rows?.[0]?.count) && rows[0].count >= 0 ? rows[0].count : 0
}

async function countSentMessagesToday(AlertDelivery, savedSearchId, dayStart) {
  const rows = await AlertDelivery.aggregate([
    {
      $match: {
        savedSearchId,
        status: 'sent',
        sentAt: { $gte: dayStart },
        batchKey: { $type: 'string' },
      },
    },
    { $group: { _id: '$batchKey' } },
    { $count: 'count' },
  ])
  return Number.isSafeInteger(rows?.[0]?.count) && rows[0].count >= 0 ? rows[0].count : 0
}

async function latestLedgerAttemptAt(AlertDelivery, savedSearchId) {
  let query = AlertDelivery.findOne({
    savedSearchId,
    status: { $in: ['sent', 'unknown', 'sending'] },
    lastAttemptAt: { $type: 'date' },
  })
  query = queryMethod(query, 'sort', { lastAttemptAt: -1 })
  query = queryMethod(query, 'select', 'lastAttemptAt')
  query = queryMethod(query, 'lean')
  const latest = await query
  return isDate(latest?.lastAttemptAt) ? latest.lastAttemptAt : null
}

function latestDate(left, right) {
  if (!isDate(left)) return isDate(right) ? right : null
  if (!isDate(right)) return left
  return left.getTime() >= right.getTime() ? left : right
}

function propertyQuery(Property, filter) {
  let query = Property.find(filter)
  query = queryMethod(query, 'sort', { createdAt: 1, _id: 1 })
  query = queryMethod(query, 'select', PROPERTY_FIELDS)
  return query
}

async function findDeliveryRows(AlertDelivery, savedSearchId, propertyIds) {
  if (propertyIds.length === 0) return []
  let query = AlertDelivery.find({ savedSearchId, propertyId: { $in: propertyIds } })
  query = queryMethod(query, 'select', '_id savedSearchId propertyId status attempts nextAttemptAt errorCode batchKey leaseToken')
  query = queryMethod(query, 'lean')
  return await query
}

function retryIsDue(row, now) {
  return row.status === 'failed' && row.errorCode === 'notification_not_configured' &&
    safeInteger(row.attempts, MAX_DELIVERY_ATTEMPTS, 0, MAX_DELIVERY_ATTEMPTS) < MAX_DELIVERY_ATTEMPTS &&
    (!isDate(row.nextAttemptAt) || row.nextAttemptAt.getTime() <= now.getTime())
}

async function markQueuedDeliveries(AlertDelivery, savedSearchId, propertyIds, now) {
  if (propertyIds.length === 0) return
  const documents = propertyIds.map(propertyId => ({
    savedSearchId,
    propertyId,
    status: 'queued',
    attempts: 0,
    nextAttemptAt: now,
  }))
  try {
    await AlertDelivery.insertMany(documents, { ordered: false })
  } catch (error) {
    if (!isDuplicateKey(error)) throw error
  }
}

async function scanNewMatches({
  search,
  Property,
  AlertDelivery,
  consentAt,
  now,
  execute,
  limit = MAX_LISTINGS_PER_DIGEST,
  onLeaseRenew,
}) {
  const cursor = queryMethod(
    propertyQuery(Property, {
      createdAt: { $gte: consentAt },
      availability: { $in: ['available', null] },
    }),
    'cursor',
    { batchSize: PROPERTY_CURSOR_BATCH },
  )
  const selected = []
  let candidateChunk = []
  const acceptChunk = async chunk => {
    if (!chunk.length || selected.length >= limit) return
    const matching = chunk.filter(property =>
      serializeProperty(property)?.availability === 'available' &&
      matchesSavedSearchProperty(search.searchCriteria, property)
    )
    if (!matching.length) return
    const ids = matching.map(property => property._id)
    const existing = await findDeliveryRows(AlertDelivery, search._id, ids)
    const byId = new Map(existing.map(row => [String(row.propertyId), row]))
    const missingIds = matching.filter(property => !byId.has(String(property._id))).map(property => property._id)
    if (execute && missingIds.length) {
      await markQueuedDeliveries(AlertDelivery, search._id, missingIds, now)
    }
    const rows = execute && missingIds.length
      ? await findDeliveryRows(AlertDelivery, search._id, ids)
      : existing
    const rowsById = new Map(rows.map(row => [String(row.propertyId), row]))
    for (const property of matching) {
      if (selected.length >= limit) break
      const row = rowsById.get(String(property._id))
      if (execute) {
        if (row?.status === 'queued' || retryIsDue(row, now)) selected.push({ property, row })
      } else if (!row || row.status === 'queued' || retryIsDue(row, now)) {
        selected.push({ property, row })
      }
    }
  }

  for await (const property of cursor) {
    candidateChunk.push(property)
    if (candidateChunk.length === PROPERTY_CURSOR_BATCH) {
      await acceptChunk(candidateChunk)
      candidateChunk = []
      if (onLeaseRenew) await onLeaseRenew()
      if (selected.length >= limit) break
    }
  }
  if (candidateChunk.length && selected.length < limit) await acceptChunk(candidateChunk)
  return selected
}

async function recheckMatches({ SavedSearch, Property, searchId, propertyRows, now }) {
  const currentSearchQuery = SavedSearch.findOne({ _id: searchId, ...ACTIVE_CONSENT_FILTER })
  const currentSearch = await queryMethod(queryMethod(currentSearchQuery, 'select', SEARCH_FIELDS), 'lean')
  if (!currentSearch || !validConsent(currentSearch, now) ||
      typeof currentSearch.userEmail !== 'string' ||
      currentSearch.userEmail !== currentSearch.userEmail.trim().toLowerCase() ||
      !currentSearch.userEmail.trim()) {
    return { search: null, properties: [], invalidIds: propertyRows.map(row => row.property._id) }
  }
  const consentAt = currentSearch.alertConsentAt
  const ids = propertyRows.map(row => row.property._id)
  let propertyRead = Property.find({
    _id: { $in: ids },
    createdAt: { $gte: consentAt },
    availability: { $in: ['available', null] },
  })
  propertyRead = queryMethod(propertyRead, 'select', PROPERTY_FIELDS)
  propertyRead = queryMethod(propertyRead, 'lean')
  const currentProperties = await propertyRead
  const byId = new Map(currentProperties.map(property => [String(property._id), property]))
  const valid = []
  const invalidIds = []
  for (const row of propertyRows) {
    const property = byId.get(String(row.property._id))
    if (property && serializeProperty(property)?.availability === 'available' &&
        matchesSavedSearchProperty(currentSearch.searchCriteria, property)) {
      valid.push({ ...row, property })
    } else {
      invalidIds.push(row.property._id)
    }
  }
  return { search: currentSearch, properties: valid, invalidIds }
}

async function markInvalidRows(AlertDelivery, searchId, invalidIds, code, now) {
  if (!invalidIds.length) return
  await AlertDelivery.updateMany({
    savedSearchId: searchId,
    propertyId: { $in: invalidIds },
    status: { $in: ['queued', 'failed'] },
  }, {
    $set: { status: 'failed', errorCode: code, finishedAt: now, nextAttemptAt: null },
  })
}

async function startSendingBatch({ AlertDelivery, searchId, selected, leaseToken, batchKey, leaseExpiresAt, now }) {
  const ids = selected.map(item => item.row.propertyId ?? item.property._id)
  const queuedResult = await AlertDelivery.updateMany({
    savedSearchId: searchId,
    propertyId: { $in: ids },
    $or: [
      { status: 'queued' },
      {
        status: 'failed',
        errorCode: 'notification_not_configured',
        attempts: { $lt: MAX_DELIVERY_ATTEMPTS },
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
    ],
  }, {
    $set: {
      status: 'sending',
      batchKey,
      leaseToken,
      leaseExpiresAt,
      lastAttemptAt: now,
      sendStartedAt: now,
      nextAttemptAt: null,
      errorCode: null,
    },
    $inc: { attempts: 1 },
  })
  let query = AlertDelivery.find({ savedSearchId: searchId, batchKey, leaseToken, status: 'sending' })
  query = queryMethod(query, 'select', '_id propertyId attempts')
  query = queryMethod(query, 'lean')
  const rows = await query
  const expected = selected.length
  if (modificationCount(queuedResult) !== expected || rows.length !== expected) {
    if (rows.length) {
      await AlertDelivery.updateMany({ savedSearchId: searchId, batchKey, leaseToken, status: 'sending' }, {
        $set: { status: 'queued', batchKey: null, leaseToken: null, leaseExpiresAt: null, sendStartedAt: null, lastAttemptAt: null, errorCode: null },
        $inc: { attempts: -1 },
      })
    }
    return null
  }
  return rows
}

async function updateLegacyCounters(SavedSearch, search, sentAt, messagesSentToday) {
  await SavedSearch.updateOne({
    _id: search._id,
    isActive: true,
    'alertSettings.isActive': true,
    verifiedAt: { $type: 'date' },
    alertConsentAt: { $type: 'date' },
  }, {
    $inc: { totalAlertsSent: 1 },
    $set: {
      lastAlertSent: sentAt,
      alertsSentToday: messagesSentToday,
      lastAlertResetDate: getNairobiDayStart(sentAt),
    },
  })
}

async function processSearch({
  search,
  SavedSearch,
  Property,
  AlertDelivery,
  AlertLease,
  now,
  clock,
  execute,
  deliver,
  summary,
  workerHeartbeat,
}) {
  if (!validConsent(search, now) ||
      typeof search.userEmail !== 'string' || search.userEmail !== search.userEmail.trim().toLowerCase() ||
      !search.userEmail.trim()) {
    summary.skipped += 1
    return
  }
  const leaseToken = execute ? randomUUID() : null
  const lease = execute
    ? await claimLease(AlertLease, { searchId: search._id }, leaseToken, clockDate(clock), WORKER_LEASE_MS)
    : null
  if (execute && !lease) {
    summary.skipped += 1
    return
  }
  const heartbeat = execute ? startHeartbeat({
    AlertLease,
    AlertDelivery,
    leaseFilter: { searchId: search._id },
    token: leaseToken,
    clock,
    ttlMs: WORKER_LEASE_MS,
    searchId: search._id,
  }) : null
  try {
    if (execute && (!(await workerHeartbeat.renewNow()) || !(await heartbeat.renewNow()))) {
      summary.skipped += 1
      return
    }
    const oldSendingQuery = AlertDelivery.find({
      savedSearchId: search._id,
      status: 'sending',
      ...(execute ? { leaseToken: { $ne: leaseToken } } : {}),
    })
    const oldSending = await queryMethod(queryMethod(oldSendingQuery, 'select', 'batchKey'), 'lean')
    if (oldSending.length) {
      if (execute) {
        const staleBatchKeys = new Set(oldSending.map(row => row.batchKey).filter(Boolean))
        const unknownCount = Math.max(1, staleBatchKeys.size)
        await AlertDelivery.updateMany({
          savedSearchId: search._id,
          status: 'sending',
          leaseToken: { $ne: leaseToken },
        }, {
          $set: { status: 'unknown', errorCode: 'delivery_uncertain', finishedAt: clockDate(clock) },
        })
        summary.unknownMessages += unknownCount
      }
      summary.skipped += 1
      return
    }

    const frequency = search.alertSettings?.frequency ?? 'daily'
    if (!['immediate', 'daily', 'weekly'].includes(frequency)) {
      summary.skipped += 1
      return
    }
    const ledgerLastAttempt = frequency === 'immediate' ? null : await latestLedgerAttemptAt(AlertDelivery, search._id)
    const anchor = latestDate(latestDate(search.lastAlertSent, ledgerLastAttempt), search.alertConsentAt) ?? search.createdAt ?? null
    if (!isCadenceDue(frequency, anchor, now)) {
      summary.skipped += 1
      return
    }
    const maxMessages = safeInteger(search.alertSettings?.maxAlertsPerDay, 5, 1, 20)
    const dayStart = getNairobiDayStart(now)
    const messagesAttemptedToday = await countAttemptedMessagesToday(AlertDelivery, search._id, dayStart)
    if (messagesAttemptedToday >= maxMessages) {
      summary.skipped += 1
      return
    }

    const matches = await scanNewMatches({
      search,
      Property,
      AlertDelivery,
      consentAt: search.alertConsentAt,
      now: clockDate(clock),
      execute,
      onLeaseRenew: execute ? async () => {
        if (!(await workerHeartbeat.renewNow()) || !(await heartbeat.renewNow())) {
          throw new Error('worker_lease_lost')
        }
      } : undefined,
    })
    if (!matches.length) {
      summary.skipped += 1
      return
    }
    summary.potentialMessages += 1
    if (!execute) return

    const latestNow = clockDate(clock)
    const validation = await recheckMatches({
      SavedSearch,
      Property,
      searchId: search._id,
      propertyRows: matches,
      now,
    })
    if (!validation.search) {
      await markInvalidRows(AlertDelivery, search._id, matches.map(item => item.property._id), 'consent_revoked', latestNow)
      summary.skipped += 1
      return
    }
    if (validation.invalidIds.length) {
      await markInvalidRows(AlertDelivery, search._id, validation.invalidIds, 'listing_unavailable', latestNow)
    }
    if (!validation.properties.length) {
      summary.skipped += 1
      return
    }
    if (!(await workerHeartbeat.renewNow()) || !(await heartbeat.renewNow())) {
      summary.skipped += 1
      return
    }
    const currentSearch = validation.search
    const batchKey = randomUUID()
    const leaseExpiresAt = new Date(clockDate(clock).getTime() + WORKER_LEASE_MS)
    const sendingRows = await startSendingBatch({
      AlertDelivery,
      searchId: currentSearch._id,
      selected: validation.properties,
      leaseToken,
      batchKey,
      leaseExpiresAt,
      now: clockDate(clock),
    })
    if (!sendingRows) {
      summary.skipped += 1
      return
    }
    if (!(await workerHeartbeat.renewNow()) || !(await heartbeat.renewNow())) {
      await AlertDelivery.updateMany({ savedSearchId: currentSearch._id, batchKey, leaseToken, status: 'sending' }, {
        $set: {
          status: 'queued', batchKey: null, leaseToken: null, leaseExpiresAt: null,
          sendStartedAt: null, lastAttemptAt: null, errorCode: null,
        },
        $inc: { attempts: -1 },
      }).catch(() => {})
      summary.skipped += 1
      return
    }

    let result
    try {
      result = await deliver(currentSearch, validation.properties.map(item => item.property))
    } catch {
      result = { success: false, error: 'delivery_uncertain' }
    }
    const finishedAt = clockDate(clock)
    if (result?.success === true) {
      try {
        const completed = await AlertDelivery.updateMany({
          savedSearchId: currentSearch._id,
          batchKey,
          leaseToken,
          status: 'sending',
        }, {
          $set: {
            status: 'sent',
            sentAt: finishedAt,
            finishedAt,
            errorCode: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        })
        if (modificationCount(completed) !== sendingRows.length) {
          summary.unknownMessages += 1
          await AlertDelivery.updateMany({ savedSearchId: currentSearch._id, batchKey, leaseToken, status: 'sending' }, {
            $set: { status: 'unknown', errorCode: 'delivery_uncertain', finishedAt },
          }).catch(() => {})
          return
        }
        summary.sentMessages += 1
        try {
          const messagesSentToday = await countSentMessagesToday(
            AlertDelivery,
            currentSearch._id,
            getNairobiDayStart(finishedAt),
          )
          await updateLegacyCounters(SavedSearch, currentSearch, finishedAt, messagesSentToday)
        } catch {
          // The sent ledger remains authoritative and prevents duplicate SMTP sends.
        }
      } catch {
        summary.unknownMessages += 1
        await AlertDelivery.updateMany({ savedSearchId: currentSearch._id, batchKey, leaseToken, status: 'sending' }, {
          $set: { status: 'unknown', errorCode: 'delivery_uncertain', finishedAt },
        }).catch(() => {})
      }
      return
    }

    if (result?.error === 'notification_not_configured') {
      const attempts = Math.max(...sendingRows.map(row => row.attempts ?? 1))
      const backoff = RETRY_BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), RETRY_BACKOFF_MS.length - 1)]
      await AlertDelivery.updateMany({ savedSearchId: currentSearch._id, batchKey, leaseToken, status: 'sending' }, {
        $set: {
          status: 'failed',
          errorCode: 'notification_not_configured',
          finishedAt,
          nextAttemptAt: attempts < MAX_DELIVERY_ATTEMPTS ? new Date(finishedAt.getTime() + backoff) : null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      })
      summary.skipped += 1
      return
    }

    await AlertDelivery.updateMany({ savedSearchId: currentSearch._id, batchKey, leaseToken, status: 'sending' }, {
      $set: {
        status: 'unknown',
        errorCode: 'delivery_uncertain',
        finishedAt,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    summary.unknownMessages += 1
  } finally {
    if (heartbeat) {
      await heartbeat.stop()
      await AlertLease.updateOne({ searchId: search._id, leaseToken }, {
        $set: { expiresAt: clockDate(clock) },
      })
    }
  }
}

/** One bounded, dry-run-by-default execution of verified saved-search alerts. */
export async function runSavedSearchAlerts({
  execute = false,
  now = new Date(),
  batchSize = 25,
  env = process.env,
  clock = () => new Date(),
  models = {},
  sendPropertyAlert = defaultSendPropertyAlert,
  getSmtp = getSmtpConfiguration,
  getOrigin = getTrustedFrontendOrigin,
} = {}) {
  assertOptions({ execute, now, batchSize, env, clock })
  if (typeof sendPropertyAlert !== 'function' || typeof getSmtp !== 'function' || typeof getOrigin !== 'function') {
    throw new TypeError('delivery/configuration adapters must be functions')
  }
  const ready = env.SAVED_SEARCH_ALERTS_ENABLED === 'true' && smtpReady(env, getSmtp, getOrigin)
  const effectiveExecute = execute && ready
  const summary = summaryTemplate({ dryRun: !effectiveExecute, disabled: execute && !ready })
  if (execute && !ready) return summary

  const SavedSearch = models.SavedSearch ?? SavedSearchModel
  const Property = models.Property ?? PropertyModel
  const AlertDelivery = models.AlertDelivery ?? AlertDeliveryModel
  const AlertLease = models.AlertLease ?? AlertLeaseModel
  if (effectiveExecute) {
    await Promise.all([
      AlertDelivery.createIndexes(),
      AlertLease.createIndexes(),
    ])
  }
  const scanBudget = Math.min(MAX_SEARCH_SCAN, Math.max(batchSize, batchSize * SEARCH_SCAN_MULTIPLIER))
  const cursorQuery = AlertLease.findOne({ workerKey: WORKER_KEY })
  const savedCursor = await queryMethod(queryMethod(cursorQuery, 'select', 'lastSearchId'), 'lean')
  const cursorId = savedCursor?.lastSearchId ?? null
  let globalToken = null
  let globalHeartbeat = null
  let lastScannedId = cursorId
  let continuation = false

  if (effectiveExecute) {
    globalToken = randomUUID()
    const globalLease = await claimLease(
      AlertLease,
      { workerKey: WORKER_KEY },
      globalToken,
      clockDate(clock),
      WORKER_LEASE_MS,
    )
    if (!globalLease) {
      summary.skipped += 1
      summary.continuation = true
      return summary
    }
    lastScannedId = globalLease.lastSearchId ?? cursorId
    globalHeartbeat = startHeartbeat({
      AlertLease,
      AlertDelivery,
      leaseFilter: { workerKey: WORKER_KEY },
      token: globalToken,
      clock,
      ttlMs: WORKER_LEASE_MS,
    })
  }

  try {
    const { searches, continuation: searchPageContinuation } = await boundedSearches(SavedSearch, lastScannedId, scanBudget)
    continuation = searchPageContinuation
    let handled = 0
    for (let index = 0; index < searches.length; index += 1) {
      if (handled >= batchSize) {
        continuation = true
        break
      }
      const search = searches[index]
      summary.checkedSearches += 1
      lastScannedId = search._id
      if (effectiveExecute && globalHeartbeat.isLost()) {
        continuation = true
        break
      }
      try {
        const before = summary.sentMessages + summary.unknownMessages + summary.potentialMessages + summary.skipped
        await processSearch({
          search,
          SavedSearch,
          Property,
          AlertDelivery,
          AlertLease,
          now,
          clock,
          execute: effectiveExecute,
          deliver: sendPropertyAlert,
          summary,
          workerHeartbeat: globalHeartbeat,
        })
        if (summary.sentMessages + summary.unknownMessages + summary.potentialMessages + summary.skipped > before) handled += 1
      } catch {
        summary.skipped += 1
        handled += 1
      }
    }
    if (searches.length >= scanBudget) continuation = true
  } finally {
    summary.continuation = continuation
    if (globalHeartbeat) await globalHeartbeat.stop()
    if (globalToken) {
      await AlertLease.updateOne({ workerKey: WORKER_KEY, leaseToken: globalToken }, {
        $set: { expiresAt: clockDate(clock), lastSearchId: lastScannedId },
      })
    }
  }
  return summary
}

export const savedSearchAlertWorkerContract = Object.freeze({
  batchSizeDefault: 25,
  batchSizeMaximum: 100,
  propertyCursorBatchSize: PROPERTY_CURSOR_BATCH,
  digestListingLimit: MAX_LISTINGS_PER_DIGEST,
  maximumDeliveryAttempts: MAX_DELIVERY_ATTEMPTS,
  leaseMilliseconds: WORKER_LEASE_MS,
  requiredConsentFields: Object.freeze(['verifiedAt', 'alertConsentAt']),
})
