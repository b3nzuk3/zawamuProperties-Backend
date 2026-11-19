import express from 'express'
import authMiddleware from '../middleware/authMiddleware.js'
import adminMiddleware from '../middleware/adminMiddleware.js'
const router = express.Router()
router.use(authMiddleware, adminMiddleware)

// @route   GET /api/analytics
// @desc    Get analytics data
router.get('/', (req, res) => {
  res.send('Analytics endpoint')
})

export default router
