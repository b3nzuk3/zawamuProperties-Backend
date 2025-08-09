import mongoose from 'mongoose'

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    author: { type: String }, // changed from ObjectId to String for now
    category: { type: String },
    readTime: { type: String },
    image: { type: String },
    date: { type: String },
    tags: [String],
  },
  { timestamps: true }
)

const Blog = mongoose.model('Blog', blogSchema)
export default Blog
