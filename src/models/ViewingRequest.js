import mongoose from 'mongoose'

const viewingRequestSchema = new mongoose.Schema(
  {
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
    },
    propertyTitle: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
    preferredDate: { type: Date, required: true },
    preferredTime: { type: String, required: true },
    message: { type: String },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed'],
      default: 'pending',
    },
    notes: { type: String }, // Admin notes
  },
  { timestamps: true }
)

const ViewingRequest = mongoose.model('ViewingRequest', viewingRequestSchema)
export default ViewingRequest
