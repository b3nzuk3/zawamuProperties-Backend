import express from 'express'
import {
  getAllBlogs,
  getBlogById,
  createBlog,
  updateBlog,
  deleteBlog,
} from '../controllers/blogController.js'
const router = express.Router()

router.get('/', getAllBlogs)
router.post('/', createBlog)
router.get('/:id', getBlogById)
router.put('/:id', updateBlog)
router.delete('/:id', deleteBlog)

export default router
