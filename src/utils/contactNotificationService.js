import { randomUUID } from 'node:crypto'
import Contact from '../models/Contact.js'
import { sendContactNotification } from './contactEmailService.js'

export const MAX_NOTIFICATION_ATTEMPTS = 5
export const NOTIFICATION_LEASE_MS = 2 * 60 * 1000

export async function attemptContactNotification(contactId) {
  const now = new Date()
  const leaseToken = randomUUID()
  const leaseUntil = new Date(now.getTime() + NOTIFICATION_LEASE_MS)
  const filter = {
    _id: contactId,
    $and: [
      {
        $or: [
          { 'notification.status': { $in: ['pending', 'failed'] } },
          { 'notification.status': { $exists: false } },
          { 'notification.status': null },
          { 'notification.status': 'sending', 'notification.leaseUntil': { $lte: now } },
        ],
      },
      {
        $or: [
          { 'notification.attempts': { $lt: MAX_NOTIFICATION_ATTEMPTS } },
          { 'notification.attempts': { $exists: false } },
        ],
      },
    ],
  }
  const claim = await Contact.findOneAndUpdate(filter, {
    $set: {
      'notification.status': 'sending',
      'notification.lastAttemptAt': now,
      'notification.leaseToken': leaseToken,
      'notification.leaseUntil': leaseUntil,
    },
    $inc: { 'notification.attempts': 1 },
    $unset: { 'notification.lastError': 1 },
  }, { new: true, runValidators: true })

  if (!claim) return null

  let delivery
  try {
    delivery = await sendContactNotification(claim)
  } catch {
    delivery = { success: false, errorCode: 'delivery_uncertain' }
  }
  const safeError = delivery?.success
    ? null
    : ['notification_not_configured', 'delivery_uncertain'].includes(delivery?.errorCode)
      ? delivery.errorCode
      : 'delivery_uncertain'
  return Contact.findOneAndUpdate({
    _id: contactId,
    'notification.leaseToken': leaseToken,
  }, {
    $set: {
      'notification.status': delivery?.success ? 'sent' : 'failed',
      'notification.lastError': safeError,
    },
    $unset: {
      'notification.leaseToken': 1,
      'notification.leaseUntil': 1,
    },
  }, { new: true, runValidators: true })
}
