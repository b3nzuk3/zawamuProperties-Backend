import express from 'express'
import authMiddleware from '../middleware/authMiddleware.js'
import adminMiddleware from '../middleware/adminMiddleware.js'
import {
  getContact,
  listContacts,
  retryContactNotification,
  submitContact,
  updateContactStatus,
} from '../controllers/contactController.js'

const router = express.Router()

router.post('/', submitContact)
router.get('/', authMiddleware, adminMiddleware, listContacts)
router.get('/:id', authMiddleware, adminMiddleware, getContact)
router.patch('/:id', authMiddleware, adminMiddleware, updateContactStatus)
router.post('/:id/retry-notification', authMiddleware, adminMiddleware, retryContactNotification)

export default router
