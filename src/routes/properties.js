import express from 'express'
import {
  getAllProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
} from '../controllers/propertiesController.js'
import authMiddleware from '../middleware/authMiddleware.js'
import adminMiddleware from '../middleware/adminMiddleware.js'
const router = express.Router()

router.get('/', getAllProperties)
router.post('/', authMiddleware, adminMiddleware, createProperty)
router.get('/:id', getPropertyById)
router.put('/:id', authMiddleware, adminMiddleware, updateProperty)
router.delete('/:id', authMiddleware, adminMiddleware, deleteProperty)

export default router
