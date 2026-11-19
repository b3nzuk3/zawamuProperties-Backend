import SavedSearch from '../models/SavedSearch.js'
import Property from '../models/Property.js'
import { sendPropertyAlerts } from '../utils/emailService.js'
import { serializeProperty } from '../utils/propertyRules.js'
import { validateSavedSearchCriteria } from '../utils/savedSearchRules.js'

function parsePositiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : null
}

// Create a new saved search
const createSavedSearch = async (req, res) => {
  try {
    const {
      userEmail,
      userName,
      userPhone,
      searchCriteria,
      alertSettings,
      name,
      description,
    } = req.body

    // Validate required fields
    if (!userEmail || !userName || !searchCriteria || !name) {
      return res.status(400).json({
        success: false,
        message:
          'Missing required fields: userEmail, userName, searchCriteria, and name are required',
      })
    }

    let validatedCriteria
    try {
      validatedCriteria = validateSavedSearchCriteria(searchCriteria)
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message })
    }

    // Check if user already has a saved search with the same name
    const existingSearch = await SavedSearch.findOne({
      userEmail: userEmail.toLowerCase(),
      name: name.trim(),
      isActive: true,
    })

    if (existingSearch) {
      return res.status(400).json({
        success: false,
        message: 'You already have a saved search with this name',
      })
    }

    // Create new saved search
    const savedSearch = new SavedSearch({
      userEmail: userEmail.toLowerCase(),
      userName: userName.trim(),
      userPhone: userPhone?.trim(),
      searchCriteria: validatedCriteria,
      alertSettings: alertSettings || {
        isActive: true,
        frequency: 'daily',
        maxAlertsPerDay: 5,
      },
      name: name.trim(),
      description: description?.trim(),
    })

    await savedSearch.save()

    res.status(201).json({
      success: true,
      message: 'Search saved successfully',
      data: savedSearch,
    })
  } catch (error) {
    console.error('Error creating saved search:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to create saved search',
      error: error.message,
    })
  }
}

// Get all saved searches for a user
const getUserSavedSearches = async (req, res) => {
  try {
    const { userEmail } = req.params

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User email is required',
      })
    }

    const savedSearches = await SavedSearch.find({
      userEmail: userEmail.toLowerCase(),
      isActive: true,
    }).sort({ createdAt: -1 })

    res.json({
      success: true,
      data: savedSearches,
    })
  } catch (error) {
    console.error('Error fetching saved searches:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch saved searches',
      error: error.message,
    })
  }
}

// Get a specific saved search
const getSavedSearch = async (req, res) => {
  try {
    const { id } = req.params

    const savedSearch = await SavedSearch.findById(id)

    if (!savedSearch) {
      return res.status(404).json({
        success: false,
        message: 'Saved search not found',
      })
    }

    res.json({
      success: true,
      data: savedSearch,
    })
  } catch (error) {
    console.error('Error fetching saved search:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch saved search',
      error: error.message,
    })
  }
}

// Update a saved search
const updateSavedSearch = async (req, res) => {
  try {
    const { id } = req.params
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, message: 'Update body must be an object' })
    }
    const updates = { ...req.body }

    // Criteria must enter through the complete validated object, not Mongo operators
    // or dotted paths that bypass cross-field validation.
    if (Object.keys(updates).some(key => key.startsWith('$') || key.includes('.'))) {
      return res.status(400).json({ success: false, message: 'Use plain update fields and a complete searchCriteria object' })
    }

    if (Object.hasOwn(updates, 'searchCriteria')) {
      try {
        updates.searchCriteria = validateSavedSearchCriteria(updates.searchCriteria)
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message })
      }
    }

    // Remove fields that shouldn't be updated directly
    delete updates._id
    delete updates.createdAt
    delete updates.updatedAt
    delete updates.totalAlertsSent
    delete updates.alertsSentToday
    delete updates.lastAlertSent
    delete updates.lastAlertResetDate

    const savedSearch = await SavedSearch.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    })

    if (!savedSearch) {
      return res.status(404).json({
        success: false,
        message: 'Saved search not found',
      })
    }

    res.json({
      success: true,
      message: 'Saved search updated successfully',
      data: savedSearch,
    })
  } catch (error) {
    console.error('Error updating saved search:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to update saved search',
      error: error.message,
    })
  }
}

// Delete a saved search (soft delete)
const deleteSavedSearch = async (req, res) => {
  try {
    const { id } = req.params

    const savedSearch = await SavedSearch.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    )

    if (!savedSearch) {
      return res.status(404).json({
        success: false,
        message: 'Saved search not found',
      })
    }

    res.json({
      success: true,
      message: 'Saved search deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting saved search:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to delete saved search',
      error: error.message,
    })
  }
}

// Get matching properties for a saved search
const getMatchingProperties = async (req, res) => {
  try {
    const { id } = req.params
    const limit = parsePositiveInteger(req.query.limit, 10, 100)
    const page = parsePositiveInteger(req.query.page, 1, 1_000_000)
    if (limit === null || page === null) {
      return res.status(400).json({ success: false, message: 'page and limit must be positive integers' })
    }

    const savedSearch = await SavedSearch.findById(id)

    if (!savedSearch) {
      return res.status(404).json({
        success: false,
        message: 'Saved search not found',
      })
    }

    // Property has no isActive field. Use a broad candidate query, then the same
    // semantic predicate as SavedSearch.matchesProperty before paginating.
    const candidates = await Property.find({}).sort({ createdAt: -1, _id: -1 })
    const matchingProperties = candidates.filter(property => savedSearch.matchesProperty(property))
    const skip = (page - 1) * limit
    const properties = matchingProperties
      .slice(skip, skip + limit)
      .map(property => serializeProperty(property))
    const total = matchingProperties.length

    res.json({
      success: true,
      data: {
        properties,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalProperties: total,
          hasNextPage: skip + properties.length < total,
          hasPrevPage: page > 1,
        },
      },
    })
  } catch (error) {
    console.error('Error fetching matching properties:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch matching properties',
      error: error.message,
    })
  }
}

// Check for new properties matching saved searches (for alert system)
const checkForNewMatches = async (req, res) => {
  try {
    const hoursBackValue = req.query.hoursBack
    const hoursBack = hoursBackValue === undefined
      ? 24
      : typeof hoursBackValue === 'string' && /^\d+(?:\.\d+)?$/.test(hoursBackValue)
        ? Number(hoursBackValue)
        : NaN
    if (!Number.isFinite(hoursBack) || hoursBack < 0 || hoursBack > 720) {
      return res.status(400).json({ success: false, message: 'hoursBack must be between 0 and 720' })
    }

    // Alert recipients must never be notified about unavailable or unknown listings.
    // Missing legacy availability is read as available by serializeProperty.
    const cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000)
    const recentProperties = await Property.find({ createdAt: { $gte: cutoffDate } })
    const newProperties = recentProperties.filter(property =>
      serializeProperty(property)?.availability === 'available'
    )

    if (newProperties.length === 0) {
      return res.json({
        success: true,
        message: 'No new available properties found',
        data: { matches: [], totalMatches: 0, newPropertiesCount: 0 },
      })
    }

    // Get all active saved searches
    const savedSearches = await SavedSearch.find({
      isActive: true,
      'alertSettings.isActive': true,
    })

    const matches = []

    for (const search of savedSearches) {
      // Reset daily alert count if needed
      search.resetDailyAlerts()

      const alertsSentToday = Number.isFinite(search.alertsSentToday) ? search.alertsSentToday : 0
      const maxAlertsPerDay = search.alertSettings?.maxAlertsPerDay ?? 5
      if (alertsSentToday >= maxAlertsPerDay) {
        continue
      }

      const matchingProperties = []

      for (const property of newProperties) {
        if (search.matchesProperty(property)) {
          matchingProperties.push(property)
        }
      }

      if (matchingProperties.length > 0) {
        matches.push({
          savedSearch: search,
          matchingProperties,
          matchCount: matchingProperties.length,
        })
      }
    }

    // Send email alerts for matches
    let emailResults = []
    if (matches.length > 0) {
      console.log(`Sending ${matches.length} property alerts...`)
      emailResults = await sendPropertyAlerts(matches)
    }

    res.json({
      success: true,
      data: {
        matches,
        totalMatches: matches.length,
        newPropertiesCount: newProperties.length,
        checkedSearches: savedSearches.length,
        emailResults,
      },
    })
  } catch (error) {
    console.error('Error checking for new matches:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to check for new matches',
      error: error.message,
    })
  }
}

export {
  createSavedSearch,
  getUserSavedSearches,
  getSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  getMatchingProperties,
  checkForNewMatches,
}
