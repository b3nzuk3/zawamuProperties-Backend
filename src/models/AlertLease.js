import mongoose from 'mongoose'

const alertLeaseSchema = new mongoose.Schema({
  // Per-search lease. The partial/sparse index excludes the singleton cursor row.
  searchId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
  leaseToken: { type: String, default: null },
  expiresAt: { type: Date, default: null },

  // One durable round-robin cursor/worker lock row. It serializes scheduled runs
  // while each search still has its own independently fenced lease.
  workerKey: { type: String, default: undefined },
  lastSearchId: { type: mongoose.Schema.Types.ObjectId, default: null },
}, {
  timestamps: true,
  strict: 'throw',
})

alertLeaseSchema.index({ searchId: 1 }, { unique: true, sparse: true })
alertLeaseSchema.index({ workerKey: 1 }, { unique: true, sparse: true })
alertLeaseSchema.index({ expiresAt: 1 })

export default mongoose.models.AlertLease ?? mongoose.model('AlertLease', alertLeaseSchema)
