import express from 'express'
import {
  getAllProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
} from '../controllers/propertiesController.js'
const router = express.Router()

router.get('/', getAllProperties)
router.post('/', createProperty)
router.get('/:id', getPropertyById)
router.put('/:id', updateProperty)
router.delete('/:id', deleteProperty)

export default router
