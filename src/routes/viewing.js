import express from 'express'
import {
  createViewingRequest,
  getAllViewingRequests,
  getViewingRequestById,
  updateViewingRequestStatus,
  deleteViewingRequest,
} from '../controllers/viewingController.js'
import authMiddleware from '../middleware/authMiddleware.js'
import adminMiddleware from '../middleware/adminMiddleware.js'

const router = express.Router()

// Public route - anyone can submit a viewing request
router.post('/', createViewingRequest)

// Viewing management requires the current persisted configured owner.
router.get('/', authMiddleware, adminMiddleware, getAllViewingRequests)
router.get('/:id', authMiddleware, adminMiddleware, getViewingRequestById)
router.put('/:id', authMiddleware, adminMiddleware, updateViewingRequestStatus)
router.delete('/:id', authMiddleware, adminMiddleware, deleteViewingRequest)

export default router
