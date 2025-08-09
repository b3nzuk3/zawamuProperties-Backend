import express from 'express'
const router = express.Router()

// @route   GET /api/analytics
// @desc    Get analytics data
router.get('/', (req, res) => {
  res.send('Analytics endpoint')
})

export default router
