import express from 'express'
import { createFeature, getFeatures } from '../controllers/featuresController.js'
import authMiddleware from '../middleware/authMiddleware.js'
import adminMiddleware from '../middleware/adminMiddleware.js'

const router = express.Router()

router.get('/', getFeatures)
router.post('/', authMiddleware, adminMiddleware, createFeature)

export default router
