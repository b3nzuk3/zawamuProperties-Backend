import SavedSearch from '../models/SavedSearch.js'
import Property from '../models/Property.js'
import {
  consumeSavedSearchManagementLink,
  isSavedSearchToken,
  requestSavedSearchManagementLink,
  revokeSavedSearchSession,
} from '../utils/savedSearchAccessService.js'
import { serializeProperty } from '../utils/propertyRules.js'
import { validateSavedSearchCriteria } from '../utils/savedSearchRules.js'
import { runSavedSearchAlerts } from '../services/savedSearchAlerts.js'

const genericAccessMessage = 'If this address can receive saved-search access, a secure link will be sent.'
const createFields = new Set(['userEmail', 'userName', 'userPhone', 'searchCriteria', 'alertSettings', 'name', 'description'])
const updateFields = new Set(['userName', 'userPhone', 'searchCriteria', 'alertSettings', 'name', 'description'])
const alertFields = new Set(['isActive', 'frequency', 'maxAlertsPerDay'])
const validFrequencies = new Set(['immediate', 'daily', 'weekly'])
const validEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/


function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && validEmail.test(email) && !/[\u0000-\u001f\u007f]/.test(email) ? email : null
}

function readText(value, { required = false, maximum }) {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string') throw new TypeError('invalid_text')
  const normalized = value.trim()
  if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError('invalid_text')
  }
  return normalized || (required ? undefined : '')
}

function validateAlertSettings(value) {
  if (!isRecord(value) || Object.keys(value).some(key => !alertFields.has(key))) {
    throw new TypeError('invalid_alert_settings')
  }
  const result = {}
  if (Object.hasOwn(value, 'isActive')) {
    if (typeof value.isActive !== 'boolean') throw new TypeError('invalid_alert_settings')
    result.isActive = value.isActive
  }
  if (Object.hasOwn(value, 'frequency')) {
    if (typeof value.frequency !== 'string' || !validFrequencies.has(value.frequency)) {
      throw new TypeError('invalid_alert_settings')
    }
    result.frequency = value.frequency
  }
  if (Object.hasOwn(value, 'maxAlertsPerDay')) {
    if (!Number.isInteger(value.maxAlertsPerDay) || value.maxAlertsPerDay < 1 || value.maxAlertsPerDay > 20) {
      throw new TypeError('invalid_alert_settings')
    }
    result.maxAlertsPerDay = value.maxAlertsPerDay
  }
  return result
}

function completeAlertSettings(partial = {}, fallback = {}) {
  return {
    isActive: Object.hasOwn(partial, 'isActive') ? partial.isActive : fallback.isActive === true,
    frequency: Object.hasOwn(partial, 'frequency') && validFrequencies.has(partial.frequency)
      ? partial.frequency
      : validFrequencies.has(fallback.frequency) ? fallback.frequency : 'daily',
    maxAlertsPerDay: Object.hasOwn(partial, 'maxAlertsPerDay')
      ? partial.maxAlertsPerDay
      : Number.isInteger(fallback.maxAlertsPerDay) && fallback.maxAlertsPerDay >= 1 && fallback.maxAlertsPerDay <= 20
        ? fallback.maxAlertsPerDay
        : 5,
  }
}

function validateCreateBody(body, sessionEmail) {
  if (!isRecord(body) || Object.keys(body).some(key => !createFields.has(key))) {
    throw new TypeError('invalid_body')
  }
  const suppliedEmail = Object.hasOwn(body, 'userEmail') ? normalizeEmail(body.userEmail) : null
  if (Object.hasOwn(body, 'userEmail') && !suppliedEmail) throw new TypeError('invalid_email')
  if (sessionEmail && suppliedEmail && suppliedEmail !== sessionEmail) throw new TypeError('email_scope_mismatch')
  const userEmail = sessionEmail || suppliedEmail
  if (!userEmail) throw new TypeError('invalid_email')

  const userName = readText(body.userName, { required: true, maximum: 120 })
  const name = readText(body.name, { required: true, maximum: 100 })
  const userPhone = readText(body.userPhone, { maximum: 40 })
  const description = readText(body.description, { maximum: 500 })
  let searchCriteria
  try {
    searchCriteria = validateSavedSearchCriteria(body.searchCriteria)
  } catch {
    throw new TypeError('invalid_criteria')
  }
  const requestedAlerts = body.alertSettings === undefined ? {} : validateAlertSettings(body.alertSettings)
  return {
    userEmail,
    userName,
    userPhone,
    name,
    description,
    searchCriteria,
    requestedAlerts,
  }
}

function plain(value) {
  return typeof value?.toObject === 'function'
    ? value.toObject({ virtuals: false, transform: false })
    : value
}

function safeDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null
}

function toSavedSearchDto(savedSearch) {
  const value = plain(savedSearch)
  if (!isRecord(value)) return null
  let searchCriteria = null
  try {
    searchCriteria = validateSavedSearchCriteria(plain(value.searchCriteria))
  } catch {
    // Null is intentionally invalid for browse replay; never substitute {}.
  }
  const settings = isRecord(plain(value.alertSettings)) ? plain(value.alertSettings) : {}
  return {
    _id: value._id == null ? '' : String(value._id),
    userEmail: typeof value.userEmail === 'string' ? value.userEmail : '',
    userName: typeof value.userName === 'string' ? value.userName : '',
    userPhone: typeof value.userPhone === 'string' ? value.userPhone : null,
    name: typeof value.name === 'string' ? value.name : '',
    description: typeof value.description === 'string' ? value.description : null,
    searchCriteria,
    alertSettings: {
      isActive: settings.isActive === true,
      frequency: validFrequencies.has(settings.frequency) ? settings.frequency : 'daily',
      maxAlertsPerDay: Number.isInteger(settings.maxAlertsPerDay) && settings.maxAlertsPerDay >= 1 && settings.maxAlertsPerDay <= 20
        ? settings.maxAlertsPerDay
        : 5,
    },
    isActive: value.isActive === true,
    verifiedAt: safeDate(value.verifiedAt),
    alertConsentAt: safeDate(value.alertConsentAt),
    createdAt: safeDate(value.createdAt),
    updatedAt: safeDate(value.updatedAt),
  }
}

function validId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)
}

function invalidRequest(res) {
  return res.status(400).json({ success: false, message: 'Invalid saved-search request' })
}

function notFound(res) {
  return res.status(404).json({ success: false, message: 'Saved search not found' })
}

async function findOwnedSearch(id, email) {
  return SavedSearch.findOne({ _id: id, userEmail: email, isActive: true })
}

export async function requestAccessLink(req, res) {
  if (!isRecord(req.body) || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'email')) {
    return invalidRequest(res)
  }
  const email = normalizeEmail(req.body.email)
  if (!email) return invalidRequest(res)
  try {
    await requestSavedSearchManagementLink(email)
  } catch {
    // Always use the same public receipt for missing records, SMTP failures and storage failures.
  }
  return res.status(202).json({ success: true, message: genericAccessMessage })
}

export async function consumeAccessLink(req, res) {
  if (!isRecord(req.body) || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'token') || !isSavedSearchToken(req.body.token)) {
    return res.status(401).json({ success: false, message: 'Invalid or expired access link' })
  }
  try {
    const session = await consumeSavedSearchManagementLink(req.body.token)
    if (!session) return res.status(401).json({ success: false, message: 'Invalid or expired access link' })
    return res.json({ success: true, data: session })
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to verify access link' })
  }
}

export async function deleteSavedSearchSession(req, res) {
  const token = req.get('X-Saved-Search-Session')
  try {
    if (isSavedSearchToken(token)) await revokeSavedSearchSession(token)
    return res.json({ success: true })
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to end saved-search session' })
  }
}

export async function createSavedSearch(req, res) {
  let input
  try {
    input = validateCreateBody(req.body, req.savedSearchScope?.email ?? null)
  } catch {
    return invalidRequest(res)
  }
  const { userEmail, userName, userPhone, name, description, searchCriteria, requestedAlerts } = input
  try {
    const duplicate = await SavedSearch.findOne({ userEmail, name, isActive: true })
    if (req.savedSearchScope) {
      if (duplicate) return res.status(409).json({ success: false, message: 'A saved search with this name already exists' })
      const now = new Date()
      const alertSettings = completeAlertSettings(requestedAlerts)
      const record = {
        userEmail,
        userName,
        searchCriteria,
        alertSettings,
        name,
        isActive: true,
        verifiedAt: now,
      }
      if (userPhone !== undefined) record.userPhone = userPhone
      if (description !== undefined) record.description = description
      if (requestedAlerts.isActive === true) record.alertConsentAt = now
      const created = await SavedSearch.create(record)
      return res.status(201).json({ success: true, message: 'Search saved successfully', data: toSavedSearchDto(created) })
    }

    if (!duplicate) {
      const record = {
        userEmail,
        userName,
        searchCriteria,
        alertSettings: completeAlertSettings({ ...requestedAlerts, isActive: false }),
        name,
        isActive: true,
      }
      if (userPhone !== undefined) record.userPhone = userPhone
      if (description !== undefined) record.description = description
      await SavedSearch.create(record)
    }
    try { await requestSavedSearchManagementLink(userEmail) } catch {
      // The public receipt stays generic; the user can explicitly request another link.
    }
    return res.status(202).json({ success: true, message: genericAccessMessage })
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to save search' })
  }
}

export async function getUserSavedSearches(req, res) {
  const email = req.savedSearchScope?.email
  if (!email) return res.status(401).json({ success: false, message: 'Saved-search access required' })
  if (req.params.userEmail !== undefined && req.params.userEmail.toLowerCase() !== email) return notFound(res)
  const page = positiveInteger(req.query.page, 1, 1_000_000)
  const limit = positiveInteger(req.query.limit, 20, 100)
  if (page === null || limit === null) return invalidRequest(res)
  try {
    const filter = { userEmail: email, isActive: true }
    const searches = await SavedSearch.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
    const total = await SavedSearch.countDocuments(filter)
    return res.json({
      success: true,
      data: searches.map(toSavedSearchDto).filter(Boolean),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalSearches: total,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    })
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to fetch saved searches' })
  }
}

export async function getSavedSearch(req, res) {
  const { id } = req.params
  if (!validId(id)) return notFound(res)
  try {
    const savedSearch = await findOwnedSearch(id, req.savedSearchScope.email)
    if (!savedSearch) return notFound(res)
    return res.json({ success: true, data: toSavedSearchDto(savedSearch) })
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to fetch saved search' })
  }
}

export async function updateSavedSearch(req, res) {
  const { id } = req.params
  if (!validId(id)) return notFound(res)
  if (!isRecord(req.body) || Object.keys(req.body).length === 0 || Object.keys(req.body).some(key => !updateFields.has(key))) {
    return invalidRequest(res)
  }

  const changes = {}
  try {
    for (const field of ['name', 'description', 'userName', 'userPhone']) {
      if (Object.hasOwn(req.body, field)) {
        const max = field === 'name' ? 100 : field === 'description' ? 500 : field === 'userName' ? 120 : 40
        changes[field] = readText(req.body[field], { required: field === 'name' || field === 'userName', maximum: max })
      }
    }
    if (Object.hasOwn(req.body, 'searchCriteria')) changes.searchCriteria = validateSavedSearchCriteria(req.body.searchCriteria)
    const requestedAlerts = Object.hasOwn(req.body, 'alertSettings') ? validateAlertSettings(req.body.alertSettings) : undefined
    if (Object.keys(changes).every(key => changes[key] === undefined) && requestedAlerts === undefined) return invalidRequest(res)

    const email = req.savedSearchScope.email
    const existing = await findOwnedSearch(id, email)
    if (!existing) return notFound(res)
    if (changes.name !== undefined && changes.name !== existing.name) {
      const duplicate = await SavedSearch.findOne({ userEmail: email, name: changes.name, isActive: true, _id: { $ne: id } })
      if (duplicate) return res.status(409).json({ success: false, message: 'A saved search with this name already exists' })
    }

    const set = { ...changes }
    const now = new Date()
    if (requestedAlerts !== undefined) {
      set.alertSettings = completeAlertSettings(requestedAlerts, plain(existing.alertSettings))
      if (requestedAlerts.isActive === true) {
        if (!(existing.verifiedAt instanceof Date) || !Number.isFinite(existing.verifiedAt.getTime())) set.verifiedAt = now
        set.alertConsentAt = now
      } else if (requestedAlerts.isActive === false) {
        set.alertConsentAt = null
      }
    }
    const updated = await SavedSearch.findOneAndUpdate(
      { _id: id, userEmail: email, isActive: true },
      { $set: set },
      { new: true, runValidators: true },
    )
    if (!updated) return notFound(res)
    return res.json({ success: true, message: 'Saved search updated successfully', data: toSavedSearchDto(updated) })
  } catch (error) {
    if (error instanceof TypeError) return invalidRequest(res)
    return res.status(500).json({ success: false, message: 'Unable to update saved search' })
  }
}

export async function deleteSavedSearch(req, res) {
  const { id } = req.params
  if (!validId(id)) return notFound(res)
  try {
    const deleted = await SavedSearch.findOneAndUpdate(
      { _id: id, userEmail: req.savedSearchScope.email, isActive: true },
      { $set: { isActive: false, 'alertSettings.isActive': false, alertConsentAt: null } },
      { new: true },
    )
    if (!deleted) return notFound(res)
    return res.json({ success: true })
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to delete saved search' })
  }
}

function positiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : null
}

export async function getMatchingProperties(req, res) {
  const { id } = req.params
  if (!validId(id)) return notFound(res)
  const limit = positiveInteger(req.query.limit, 10, 100)
  const page = positiveInteger(req.query.page, 1, 1_000_000)
  if (limit === null || page === null) return invalidRequest(res)

  let cursor
  try {
    const savedSearch = await findOwnedSearch(id, req.savedSearchScope.email)
    if (!savedSearch) return notFound(res)

    cursor = Property.find({}).sort({ createdAt: -1, _id: -1 }).cursor({ batchSize: 100 })
    const skip = (page - 1) * limit
    let total = 0
    const properties = []
    for await (const property of cursor) {
      if (!savedSearch.matchesProperty(property)) continue
      if (total >= skip && properties.length < limit) properties.push(serializeProperty(property))
      total += 1
    }
    return res.json({
      success: true,
      data: {
        properties,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalProperties: total,
          hasNextPage: skip + properties.length < total,
          hasPrevPage: page > 1,
        },
      },
    })
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to fetch matching properties' })
  } finally {
    if (cursor && typeof cursor.close === 'function') {
      try { await cursor.close() } catch {
        // Cursor cleanup is best-effort after a bounded read.
      }
    }
  }
}

export async function checkForNewMatches(_req, res) {
  try {
    const result = await runSavedSearchAlerts({ execute: true })
    return res.json({ success: true, data: result })
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to run saved-search alerts' })
  }
}
