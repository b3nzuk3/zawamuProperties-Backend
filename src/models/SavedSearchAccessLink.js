import mongoose from 'mongoose'

const savedSearchAccessLinkSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, immutable: true, select: false },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' })

savedSearchAccessLinkSchema.index({ tokenHash: 1 }, { unique: true })
savedSearchAccessLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
savedSearchAccessLinkSchema.index({ email: 1, createdAt: -1 })

export default mongoose.model('SavedSearchAccessLink', savedSearchAccessLinkSchema)
