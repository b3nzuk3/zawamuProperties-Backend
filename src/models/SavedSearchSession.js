import mongoose from 'mongoose'

const savedSearchSessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, immutable: true, select: false },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' })

savedSearchSessionSchema.index({ tokenHash: 1 }, { unique: true })
savedSearchSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
savedSearchSessionSchema.index({ email: 1, revokedAt: 1 })

export default mongoose.model('SavedSearchSession', savedSearchSessionSchema)
