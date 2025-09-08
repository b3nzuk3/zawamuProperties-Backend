import express from 'express'
import {
  createViewingRequest,
  getAllViewingRequests,
  getViewingRequestById,
  updateViewingRequestStatus,
  deleteViewingRequest,
} from '../controllers/viewingController.js'
import authMiddleware from '../middleware/authMiddleware.js'

const router = express.Router()

// Public route - anyone can submit a viewing request
router.post('/', createViewingRequest)

// Admin routes - require authentication
router.get('/', authMiddleware, getAllViewingRequests)
router.get('/:id', authMiddleware, getViewingRequestById)
router.put('/:id', authMiddleware, updateViewingRequestStatus)
router.delete('/:id', authMiddleware, deleteViewingRequest)

export default router
