import mongoose from 'mongoose'

const propertySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    location: { type: String, required: true }, // Keep for backward compatibility
    county: { type: String, required: true },
    constituency: { type: String, required: true },
    ward: { type: String, required: true },
    coordinates: {
      type: [Number],
      default: null,
      validate: {
        validator: function (v) {
          return v === null || (Array.isArray(v) && v.length === 2)
        },
        message:
          'Coordinates must be an array of 2 numbers [longitude, latitude]',
      },
    },
    type: { type: String, required: true },
    featured: { type: Boolean, default: false },
    images: [String],
    features: { type: [String], default: [] },
    bedrooms: { type: Number, default: 0 },
    bathrooms: { type: Number, default: 0 },
    area: { type: Number, default: 0 },
    listedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
)

const Property = mongoose.model('Property', propertySchema)
export default Property
