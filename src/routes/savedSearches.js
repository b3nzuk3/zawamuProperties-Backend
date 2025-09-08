import express from 'express'
import {
  createSavedSearch,
  getUserSavedSearches,
  getSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  getMatchingProperties,
  checkForNewMatches,
} from '../controllers/savedSearchController.js'

const router = express.Router()

// Public routes (no authentication required)
router.post('/', createSavedSearch)
router.get('/user/:userEmail', getUserSavedSearches)
router.get('/:id', getSavedSearch)
router.get('/:id/properties', getMatchingProperties)

// Admin routes (authentication required)
router.put('/:id', updateSavedSearch)
router.delete('/:id', deleteSavedSearch)
router.get('/admin/check-matches', checkForNewMatches)

export default router
