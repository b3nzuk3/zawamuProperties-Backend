import express from 'express'
import multer from 'multer'
import { configureCloudinary } from '../utils/cloudinary.js'
import dotenv from 'dotenv'

// Force load environment variables
dotenv.config()

const router = express.Router()
const storage = multer.memoryStorage()
const upload = multer({ storage })

// Configure Cloudinary with env vars
const cloudinary = configureCloudinary({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

console.log('Upload route ENV:', {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// Helper to upload a buffer to Cloudinary
const streamUpload = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'image' },
      (error, result) => {
        if (result) resolve(result)
        else {
          console.error('Cloudinary upload error:', error)
          reject(error)
        }
      }
    )
    stream.end(buffer)
  })
}

router.post('/', upload.array('images', 10), async (req, res) => {
  try {
    console.log('Received upload request')
    if (!req.files || req.files.length === 0) {
      console.error('No files uploaded')
      return res.status(400).json({ message: 'No files uploaded' })
    }
    const uploadResults = await Promise.all(
      req.files.map((file) => streamUpload(file.buffer))
    )
    const urls = uploadResults.map((r) => r.secure_url)
    res.json({ urls })
  } catch (err) {
    console.error('Upload failed:', err)
    res.status(500).json({ message: 'Upload failed', error: err.message })
  }
})

export default router
