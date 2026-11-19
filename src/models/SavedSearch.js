import mongoose from 'mongoose'
import { matchesSavedSearchProperty, SAVED_SEARCH_PROPERTY_TYPES } from '../utils/savedSearchRules.js'

const savedSearchSchema = new mongoose.Schema(
  {
    // User information
    userEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
    },
    userPhone: {
      type: String,
      trim: true,
    },

    // Search criteria
    searchCriteria: {
      // Location filters
      location: {
        type: String,
        trim: true,
      },
      county: {
        type: String,
        trim: true,
      },
      constituency: {
        type: String,
        trim: true,
      },
      ward: {
        type: String,
        trim: true,
      },

      // Property filters
      listingPurpose: {
        type: String,
        enum: ['sale', 'rent'],
      },
      propertyTypes: [
        {
          type: String,
          enum: SAVED_SEARCH_PROPERTY_TYPES,
        },
      ],

      // Price range
      minPrice: {
        type: Number,
        min: 0,
      },
      maxPrice: {
        type: Number,
        min: 0,
      },

      // Property features
      minBedrooms: {
        type: Number,
        min: 0,
      },
      maxBedrooms: {
        type: Number,
        min: 0,
      },
      minBathrooms: {
        type: Number,
        min: 0,
      },
      maxBathrooms: {
        type: Number,
        min: 0,
      },

      // Search term
      searchTerm: {
        type: String,
        trim: true,
      },
    },

    // Alert settings
    alertSettings: {
      isActive: {
        type: Boolean,
        default: true,
      },
      frequency: {
        type: String,
        enum: ['immediate', 'daily', 'weekly'],
        default: 'daily',
      },
      maxAlertsPerDay: {
        type: Number,
        default: 5,
        min: 1,
        max: 20,
      },
    },

    // Metadata
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // Tracking
    lastAlertSent: {
      type: Date,
    },
    totalAlertsSent: {
      type: Number,
      default: 0,
    },
    alertsSentToday: {
      type: Number,
      default: 0,
    },
    lastAlertResetDate: {
      type: Date,
      default: Date.now,
    },

    // Status
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
)

// Index for efficient querying
savedSearchSchema.index({ userEmail: 1, isActive: 1 })
savedSearchSchema.index({
  'searchCriteria.county': 1,
  'searchCriteria.constituency': 1,
  'searchCriteria.ward': 1,
})
savedSearchSchema.index({ 'searchCriteria.propertyTypes': 1 })
savedSearchSchema.index({
  'searchCriteria.minPrice': 1,
  'searchCriteria.maxPrice': 1,
})

// Method to check if search matches a property
savedSearchSchema.methods.matchesProperty = function (property) {
  return matchesSavedSearchProperty(this.searchCriteria, property)
}

// Method to reset daily alert count
savedSearchSchema.methods.resetDailyAlerts = function () {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (!this.lastAlertResetDate || this.lastAlertResetDate < today) {
    this.alertsSentToday = 0
    this.lastAlertResetDate = today
    return true
  }
  return false
}

export default mongoose.model('SavedSearch', savedSearchSchema)
