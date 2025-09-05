import express from 'express'
import {
  createViewingRequest,
  getAllViewingRequests,
  getViewingRequestById,
  updateViewingRequestStatus,
  deleteViewingRequest,
} from '../controllers/viewingController.js'
import { authenticateToken } from '../middleware/authMiddleware.js'

const router = express.Router()

// Public route - anyone can submit a viewing request
router.post('/', createViewingRequest)

// Admin routes - require authentication
router.get('/', authenticateToken, getAllViewingRequests)
router.get('/:id', authenticateToken, getViewingRequestById)
router.put('/:id', authenticateToken, updateViewingRequestStatus)
router.delete('/:id', authenticateToken, deleteViewingRequest)

export default router
