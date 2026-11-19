import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema({
  status: { type: String, enum: ['pending', 'sending', 'sent', 'failed'], default: 'pending' },
  attempts: { type: Number, min: 0, max: 5, default: 0 },
  lastAttemptAt: { type: Date, default: null },
  lastError: { type: String, maxlength: 64, default: null },
  leaseToken: { type: String, select: false },
  leaseUntil: { type: Date, select: false },
}, { _id: false })

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    phone: { type: String, trim: true, maxlength: 40 },
    subject: { type: String, trim: true, maxlength: 160 },
    interest: { type: String, trim: true, maxlength: 100 },
    source: { type: String, enum: ['general', 'property'], default: 'general' },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' },
    propertyTitle: { type: String, trim: true },
    propertyUrl: { type: String, maxlength: 2048 },
    status: { type: String, enum: ['new', 'read', 'resolved'], default: 'new' },
    notification: { type: notificationSchema, default: () => ({}) },
  },
  { timestamps: true, strict: 'throw' }
)

const Contact = mongoose.model('Contact', contactSchema)
export default Contact
