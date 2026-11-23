import mongoose from 'mongoose'

const alertDeliverySchema = new mongoose.Schema({
  savedSearchId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    immutable: true,
  },
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    immutable: true,
  },
  status: {
    type: String,
    enum: ['queued', 'sending', 'sent', 'failed', 'unknown'],
    required: true,
    default: 'queued',
  },
  batchKey: { type: String, default: null },
  leaseToken: { type: String, default: null },
  leaseExpiresAt: { type: Date, default: null },
  attempts: { type: Number, required: true, default: 0, min: 0, max: 3 },
  nextAttemptAt: { type: Date, default: null },
  lastAttemptAt: { type: Date, default: null },
  sendStartedAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  errorCode: {
    type: String,
    enum: ['notification_not_configured', 'delivery_uncertain', 'listing_unavailable', 'consent_revoked'],
    default: null,
  },
}, {
  timestamps: true,
  strict: 'throw',
})

alertDeliverySchema.index({ savedSearchId: 1, propertyId: 1 }, { unique: true })
alertDeliverySchema.index({ savedSearchId: 1, status: 1, nextAttemptAt: 1, createdAt: 1 })
alertDeliverySchema.index({ savedSearchId: 1, status: 1, sentAt: 1, batchKey: 1 })

export default mongoose.models.AlertDelivery ?? mongoose.model('AlertDelivery', alertDeliverySchema)
