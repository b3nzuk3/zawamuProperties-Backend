import express from 'express'
import {
  checkForNewMatches,
  consumeAccessLink,
  createSavedSearch,
  deleteSavedSearch,
  deleteSavedSearchSession,
  getMatchingProperties,
  getSavedSearch,
  getUserSavedSearches,
  requestAccessLink,
  updateSavedSearch,
} from '../controllers/savedSearchController.js'
import authMiddleware from '../middleware/authMiddleware.js'
import adminMiddleware from '../middleware/adminMiddleware.js'
import {
  optionalSavedSearchSession,
  requireSavedSearchSession,
  savedSearchAccessConsumeRateLimit,
  savedSearchAccessRequestRateLimit,
} from '../middleware/savedSearchAccess.js'

const router = express.Router()

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

router.post('/access-links', savedSearchAccessRequestRateLimit, requestAccessLink)
router.post('/access-links/consume', savedSearchAccessConsumeRateLimit, consumeAccessLink)
router.delete('/session', deleteSavedSearchSession)

router.post('/', savedSearchAccessRequestRateLimit, optionalSavedSearchSession, createSavedSearch)
router.get('/', requireSavedSearchSession, getUserSavedSearches)
router.get('/user/:userEmail', requireSavedSearchSession, getUserSavedSearches)

router.get('/admin/check-matches', (_req, res) => {
  res.status(405).json({ success: false, message: 'Use the explicit POST alert-runner endpoint' })
})
router.post('/admin/check-matches', authMiddleware, adminMiddleware, checkForNewMatches)
router.all('/admin/check-matches', (_req, res) => {
  res.status(405).json({ success: false, message: 'Method not allowed' })
})

router.get('/:id/properties', requireSavedSearchSession, getMatchingProperties)
router.get('/:id', requireSavedSearchSession, getSavedSearch)
router.put('/:id', requireSavedSearchSession, updateSavedSearch)
router.delete('/:id', requireSavedSearchSession, deleteSavedSearch)

export default router
