import express from 'express'
import {
  getAllBlogs,
  getBlogById,
  createBlog,
  updateBlog,
  deleteBlog,
} from '../controllers/blogController.js'
import authMiddleware from '../middleware/authMiddleware.js'
import adminMiddleware from '../middleware/adminMiddleware.js'
const router = express.Router()

router.get('/', getAllBlogs)
router.post('/', authMiddleware, adminMiddleware, createBlog)
router.get('/:id', getBlogById)
router.put('/:id', authMiddleware, adminMiddleware, updateBlog)
router.delete('/:id', authMiddleware, adminMiddleware, deleteBlog)

export default router
