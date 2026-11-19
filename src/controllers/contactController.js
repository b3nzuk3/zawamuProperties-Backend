import mongoose from 'mongoose'
import Contact from '../models/Contact.js'
import Property from '../models/Property.js'
import { attemptContactNotification } from '../utils/contactNotificationService.js'
import { buildPropertyUrl, parseContactSubmission, toContactDto } from '../utils/contactRules.js'

const CONTACT_STATUSES = new Set(['new', 'read', 'resolved'])
const CONTACT_SOURCES = new Set(['general', 'property'])

function validContactId(id) {
  return mongoose.isObjectIdOrHexString(id)
}

function parsePageValue(value, fallback, max) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null
}

export const submitContact = async (req, res) => {
  let submission
  try {
    submission = parseContactSubmission(req.body)
  } catch {
    return res.status(400).json({ message: 'Invalid enquiry details' })
  }

  try {
    let propertySnapshot = {}
    if (submission.source === 'property') {
      const property = await Property.findById(submission.propertyId).select('_id title')
      if (!property) return res.status(404).json({ message: 'Property not found' })
      propertySnapshot = {
        propertyId: property._id,
        propertyTitle: typeof property.title === 'string' ? property.title.trim() : '',
        propertyUrl: buildPropertyUrl(String(property._id)),
      }
      if (!propertySnapshot.propertyTitle) return res.status(404).json({ message: 'Property not found' })
    }

    const contact = await Contact.create({
      ...submission,
      ...propertySnapshot,
      status: 'new',
      notification: { status: 'pending', attempts: 0, lastAttemptAt: null, lastError: null },
    })

    // The record is authoritative. SMTP or notification-state failures do not undo receipt.
    try {
      await attemptContactNotification(contact._id)
    } catch {
      // A sending lease can be recovered after expiry if state persistence failed.
    }
    return res.status(201).json({ message: 'Your enquiry has been received.', received: true })
  } catch {
    return res.status(500).json({ message: 'Unable to receive enquiry' })
  }
}

export const listContacts = async (req, res) => {
  const allowedQuery = new Set(['page', 'limit', 'status', 'source'])
  if (Object.keys(req.query).some(key => !allowedQuery.has(key))) {
    return res.status(400).json({ message: 'Invalid inbox filters' })
  }
  const page = parsePageValue(req.query.page, 1, 1_000_000)
  const limit = parsePageValue(req.query.limit, 20, 100)
  if (page === null || limit === null) return res.status(400).json({ message: 'Invalid pagination' })
  if (req.query.status !== undefined && !CONTACT_STATUSES.has(req.query.status)) {
    return res.status(400).json({ message: 'Invalid status filter' })
  }
  if (req.query.source !== undefined && !CONTACT_SOURCES.has(req.query.source)) {
    return res.status(400).json({ message: 'Invalid source filter' })
  }

  const constraints = []
  if (req.query.status === 'new') {
    constraints.push({ $or: [{ status: 'new' }, { status: { $exists: false } }, { status: null }] })
  } else if (req.query.status !== undefined) {
    constraints.push({ status: req.query.status })
  }
  if (req.query.source === 'general') {
    constraints.push({ $or: [{ source: 'general' }, { source: { $exists: false } }, { source: null }] })
  } else if (req.query.source !== undefined) {
    constraints.push({ source: req.query.source })
  }
  const filter = constraints.length ? { $and: constraints } : {}
  try {
    const [items, total] = await Promise.all([
      Contact.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Contact.countDocuments(filter),
    ])
    return res.json({
      items: items.map(toContactDto),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    })
  } catch {
    return res.status(500).json({ message: 'Unable to load enquiries' })
  }
}

export const getContact = async (req, res) => {
  if (!validContactId(req.params.id)) return res.status(404).json({ message: 'Enquiry not found' })
  try {
    const contact = await Contact.findById(req.params.id)
    if (!contact) return res.status(404).json({ message: 'Enquiry not found' })
    return res.json(toContactDto(contact))
  } catch {
    return res.status(500).json({ message: 'Unable to load enquiry' })
  }
}

export const updateContactStatus = async (req, res) => {
  if (!validContactId(req.params.id)) return res.status(404).json({ message: 'Enquiry not found' })
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !CONTACT_STATUSES.has(body.status)) {
    return res.status(400).json({ message: 'Invalid enquiry status' })
  }
  try {
    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      { $set: { status: body.status } },
      { new: true, runValidators: true },
    )
    if (!contact) return res.status(404).json({ message: 'Enquiry not found' })
    return res.json(toContactDto(contact))
  } catch {
    return res.status(500).json({ message: 'Unable to update enquiry' })
  }
}

export const retryContactNotification = async (req, res) => {
  if (!validContactId(req.params.id)) return res.status(404).json({ message: 'Enquiry not found' })
  if (req.body !== undefined && (!req.body || typeof req.body !== 'object' ||
      Array.isArray(req.body) || Object.keys(req.body).length !== 0)) {
    return res.status(400).json({ message: 'Retry does not accept a request body' })
  }
  try {
    const contact = await attemptContactNotification(req.params.id)
    if (contact) return res.json(toContactDto(contact))
    const existing = await Contact.findById(req.params.id)
    if (!existing) return res.status(404).json({ message: 'Enquiry not found' })
    return res.status(409).json({ message: 'Notification cannot be retried at this time' })
  } catch {
    return res.status(500).json({ message: 'Unable to retry notification' })
  }
}
