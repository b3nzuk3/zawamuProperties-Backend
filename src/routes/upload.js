import express from 'express'
import multer from 'multer'
import { createImageStorage, ImageStorageError } from '../services/imageStorage.js'
import { IMAGE_MAX_BYTES, ImageInputError } from '../utils/imageOptimizer.js'
import authMiddleware from '../middleware/authMiddleware.js'
import adminMiddleware from '../middleware/adminMiddleware.js'

export function createUploadRouter({ storeImages = files => createImageStorage().uploadImages(files) } = {}) {
  const router = express.Router()
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: IMAGE_MAX_BYTES, files: 10, fields: 0, parts: 10 },
  }).array('images', 10)
  let active = false

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  // Authorize first, then reserve process capacity before buffering multipart.
  // There is deliberately no unbounded in-memory waiting queue.
  router.post('/', authMiddleware, adminMiddleware, (req, res) => {
    if (active) return res.set('Retry-After', '5').status(503).json({ message: 'Another image upload is in progress. Please retry shortly.' })
    active = true
    parse(req, res, async error => {
      try {
        if (error) {
          const oversized = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
          return res.status(oversized ? 413 : 400).json({ message: oversized ? 'Each image must be no larger than 8 MiB' : 'Invalid image upload request (maximum 10 images)' })
        }
        if (!req.files?.length) return res.status(400).json({ message: 'No files uploaded' })
        const result = await storeImages(req.files)
        return res.json(result)
      } catch (error) {
        if (error instanceof ImageInputError) return res.status(error.status).json({ message: error.message })
        // Do not log provider errors, credentials, request bodies or object URLs.
        if (error instanceof ImageStorageError && error.cleanupIncomplete) console.warn('Image upload compensation incomplete; inspect orphaned new objects')
        return res.status(503).json({ message: 'Image storage is temporarily unavailable' })
      } finally {
        active = false
      }
    })
  })
  return router
}

export default createUploadRouter()
