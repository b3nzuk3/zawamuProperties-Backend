import express from 'express'
import { login, profile } from '../controllers/authController.js'
import authMiddleware from '../middleware/authMiddleware.js'
const router = express.Router()

// No public registration route

// @route   POST /api/auth/login
router.post('/login', login)

// @route   GET /api/auth/profile
router.get('/profile', authMiddleware, profile)

export default router
