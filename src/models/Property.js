import mongoose from 'mongoose'
import {
  PROPERTY_AVAILABILITIES,
  PROPERTY_PURPOSES,
  calculateEffectivePrice,
  isAvailabilityCompatible,
  isPropertyTypeAllowed,
} from '../utils/propertyRules.js'

const propertySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    price: {
      type: Number,
      required: true,
      validate: {
        validator: value => Number.isFinite(value) && value > 0,
        message: 'Price must be a finite number greater than zero',
      },
    },
    location: { type: String, required: true, trim: true },
    county: { type: String, trim: true },
    constituency: { type: String, trim: true },
    ward: { type: String, trim: true },
    coordinates: {
      type: [Number],
      default: null,
      validate: {
        validator(value) {
          if (value === null) return true
          return Array.isArray(value) && value.length === 2 &&
            Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180 &&
            Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90
        },
        message: 'Coordinates must be [longitude, latitude] within valid ranges',
      },
    },
    type: {
      type: String,
      required: true,
      validate: {
        validator(value) {
          return isPropertyTypeAllowed(this.listingPurpose ?? 'sale', value)
        },
        message: 'Property type is not allowed for this listingPurpose',
      },
    },
    listingPurpose: { type: String, required: true, enum: PROPERTY_PURPOSES, default: 'sale' },
    availability: {
      type: String,
      required: true,
      enum: PROPERTY_AVAILABILITIES,
      default: 'available',
      validate: {
        validator(value) {
          return isAvailabilityCompatible(this.listingPurpose ?? 'sale', value)
        },
        message: 'Availability is incompatible with the property listingPurpose',
      },
    },
    offerPercent: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: 99.99,
      validate: {
        validator(value) {
          return Number.isFinite(value) && Number(value.toFixed(2)) === value
        },
        message: 'Offer percentage must have at most two decimal places',
      },
    },
    featured: { type: Boolean, default: false },
    images: { type: [String], default: [] },
    features: { type: [String], default: [] },
    bedrooms: { type: Number, default: 0, min: 0 },
    bathrooms: { type: Number, default: 0, min: 0 },
    area: { type: Number, default: 0, min: 0 },
    listedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    strict: 'throw',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

propertySchema.virtual('effectivePrice').get(function () {
  return calculateEffectivePrice(this.price, this.offerPercent)
})

const Property = mongoose.model('Property', propertySchema)
export default Property
