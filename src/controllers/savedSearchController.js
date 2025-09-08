import SavedSearch from '../models/SavedSearch.js'
import Property from '../models/Property.js'
import { sendPropertyAlerts } from '../utils/emailService.js'

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
      searchCriteria,
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
    const updates = req.body

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
    const { limit = 10, page = 1 } = req.query

    const savedSearch = await SavedSearch.findById(id)

    if (!savedSearch) {
      return res.status(404).json({
        success: false,
        message: 'Saved search not found',
      })
    }

    // Build query based on search criteria
    const query = { isActive: true }
    const criteria = savedSearch.searchCriteria

    // Location filters
    if (criteria.county) {
      query.county = new RegExp(criteria.county, 'i')
    }
    if (criteria.constituency) {
      query.constituency = new RegExp(criteria.constituency, 'i')
    }
    if (criteria.ward) {
      query.ward = new RegExp(criteria.ward, 'i')
    }

    // Property type filter
    if (criteria.propertyTypes && criteria.propertyTypes.length > 0) {
      query.type = { $in: criteria.propertyTypes }
    }

    // Price range filter
    if (criteria.minPrice || criteria.maxPrice) {
      query.price = {}
      if (criteria.minPrice) query.price.$gte = criteria.minPrice
      if (criteria.maxPrice) query.price.$lte = criteria.maxPrice
    }

    // Bedroom count filter
    if (criteria.minBedrooms || criteria.maxBedrooms) {
      query.bedrooms = {}
      if (criteria.minBedrooms) query.bedrooms.$gte = criteria.minBedrooms
      if (criteria.maxBedrooms) query.bedrooms.$lte = criteria.maxBedrooms
    }

    // Bathroom count filter
    if (criteria.minBathrooms || criteria.maxBathrooms) {
      query.bathrooms = {}
      if (criteria.minBathrooms) query.bathrooms.$gte = criteria.minBathrooms
      if (criteria.maxBathrooms) query.bathrooms.$lte = criteria.maxBathrooms
    }

    // Search term filter
    if (criteria.searchTerm) {
      const searchRegex = new RegExp(criteria.searchTerm, 'i')
      query.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { location: searchRegex },
      ]
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const properties = await Property.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))

    const total = await Property.countDocuments(query)

    res.json({
      success: true,
      data: {
        properties,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalProperties: total,
          hasNextPage: skip + properties.length < total,
          hasPrevPage: parseInt(page) > 1,
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
    const { hoursBack = 24 } = req.query

    // Get properties created in the last X hours
    const cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000)
    const newProperties = await Property.find({
      isActive: true,
      createdAt: { $gte: cutoffDate },
    })

    if (newProperties.length === 0) {
      return res.json({
        success: true,
        message: 'No new properties found',
        data: { matches: [], totalMatches: 0 },
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

      // Check if we can send more alerts today
      if (search.alertsSentToday >= search.alertSettings.maxAlertsPerDay) {
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
