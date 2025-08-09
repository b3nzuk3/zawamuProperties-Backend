import Blog from '../models/Blog.js'

export const getAllBlogs = async (req, res) => {
  try {
    const blogs = await Blog.find()
    res.json(blogs)
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message })
  }
}

export const getBlogById = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id)
    if (!blog) return res.status(404).json({ message: 'Blog post not found' })
    res.json(blog)
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message })
  }
}

export const createBlog = async (req, res) => {
  try {
    const blog = await Blog.create(req.body)
    res.status(201).json(blog)
  } catch (err) {
    res.status(400).json({ message: 'Invalid data', error: err.message })
  }
}

export const updateBlog = async (req, res) => {
  try {
    const blog = await Blog.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    })
    if (!blog) return res.status(404).json({ message: 'Blog post not found' })
    res.json(blog)
  } catch (err) {
    res.status(400).json({ message: 'Invalid data', error: err.message })
  }
}

export const deleteBlog = async (req, res) => {
  try {
    const blog = await Blog.findByIdAndDelete(req.params.id)
    if (!blog) return res.status(404).json({ message: 'Blog post not found' })
    res.json({ message: 'Blog post deleted' })
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message })
  }
}
