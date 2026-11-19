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

import authMiddleware from '../middleware/authMiddleware.js'
import adminMiddleware from '../middleware/adminMiddleware.js'
const router = express.Router()

// Public routes (no authentication required)
router.post('/', createSavedSearch)
router.get('/user/:userEmail', getUserSavedSearches)
router.get('/:id', getSavedSearch)
router.get('/:id/properties', getMatchingProperties)

// Legacy user update/delete contracts remain public in Phase A.
router.put('/:id', updateSavedSearch)
router.delete('/:id', deleteSavedSearch)
// Email-triggering management endpoint requires the configured owner.
router.get('/admin/check-matches', authMiddleware, adminMiddleware, checkForNewMatches)

export default router
