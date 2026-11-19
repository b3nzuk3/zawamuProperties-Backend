import mongoose from 'mongoose'
import { MAX_FEATURE_NAME_LENGTH, normalizeFeatureName } from '../utils/featureRules.js'

const featureSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      validate: {
        validator: value => typeof value === 'string' && [...value].length <= MAX_FEATURE_NAME_LENGTH,
        message: `Feature name must be ${MAX_FEATURE_NAME_LENGTH} characters or fewer`,
      },
    },
    nameKey: { type: String, required: true },
  },
  { timestamps: true },
)

featureSchema.index({ nameKey: 1 }, { unique: true })

featureSchema.pre('validate', function normalizeFeature() {
  if (typeof this.name !== 'string') return

  try {
    const normalized = normalizeFeatureName(this.name)
    this.name = normalized.name
    this.nameKey = normalized.nameKey
  } catch (error) {
    this.invalidate('name', error.message)
  }
})

const Feature = mongoose.model('Feature', featureSchema)
export default Feature
