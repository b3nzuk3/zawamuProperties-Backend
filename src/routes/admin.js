import express from 'express'
import Property from '../models/Property.js'
import Blog from '../models/Blog.js'
import Contact from '../models/Contact.js'

const router = express.Router()

// Helper to compute percent change between two numbers
function percentChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

// @route   GET /api/admin/stats
// @desc    Get admin dashboard stats (real counts and month-over-month change)
router.get('/stats', async (req, res) => {
  try {
    const now = new Date()
    const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const prev30Start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

    const [
      totalProperties,
      totalFeatured,
      totalBlogPosts,
      totalContacts,
      propertiesLast30,
      propertiesPrev30,
      featuredLast30,
      featuredPrev30,
      blogLast30,
      blogPrev30,
      contactsLast30,
      contactsPrev30,
    ] = await Promise.all([
      Property.countDocuments({}),
      Property.countDocuments({ featured: true }),
      Blog.countDocuments({}),
      Contact.countDocuments({}),
      Property.countDocuments({ createdAt: { $gte: last30Start } }),
      Property.countDocuments({
        createdAt: { $gte: prev30Start, $lt: last30Start },
      }),
      Property.countDocuments({
        featured: true,
        createdAt: { $gte: last30Start },
      }),
      Property.countDocuments({
        featured: true,
        createdAt: { $gte: prev30Start, $lt: last30Start },
      }),
      Blog.countDocuments({ createdAt: { $gte: last30Start } }),
      Blog.countDocuments({
        createdAt: { $gte: prev30Start, $lt: last30Start },
      }),
      Contact.countDocuments({ createdAt: { $gte: last30Start } }),
      Contact.countDocuments({
        createdAt: { $gte: prev30Start, $lt: last30Start },
      }),
    ])

    res.json({
      totals: {
        properties: totalProperties,
        activeListings: totalFeatured,
        blogPosts: totalBlogPosts,
        inquiries: totalContacts,
      },
      monthOverMonth: {
        properties: percentChange(propertiesLast30, propertiesPrev30),
        activeListings: percentChange(featuredLast30, featuredPrev30),
        blogPosts: percentChange(blogLast30, blogPrev30),
        inquiries: percentChange(contactsLast30, contactsPrev30),
      },
    })
  } catch (err) {
    res
      .status(500)
      .json({ message: 'Failed to load stats', error: err.message })
  }
})

// @route   GET /api/admin/recent-activity
// @desc    Get recent activity across properties, blog posts, and inquiries
router.get('/recent-activity', async (req, res) => {
  try {
    const [newProperties, updatedProperties, newBlogs, newContacts] =
      await Promise.all([
        Property.find({})
          .sort({ createdAt: -1 })
          .limit(10)
          .select('title createdAt'),
        Property.find({ $expr: { $gt: ['$updatedAt', '$createdAt'] } })
          .sort({ updatedAt: -1 })
          .limit(10)
          .select('title updatedAt createdAt'),
        Blog.find({})
          .sort({ createdAt: -1 })
          .limit(10)
          .select('title createdAt'),
        Contact.find({})
          .sort({ createdAt: -1 })
          .limit(10)
          .select('name createdAt'),
      ])

    const events = [
      ...newProperties.map((p) => ({
        action: 'New property listed',
        subject: p.title,
        timestamp: p.createdAt,
      })),
      ...updatedProperties.map((p) => ({
        action: 'Property updated',
        subject: p.title,
        timestamp: p.updatedAt,
      })),
      ...newBlogs.map((b) => ({
        action: 'Blog post published',
        subject: b.title,
        timestamp: b.createdAt,
      })),
      ...newContacts.map((c) => ({
        action: 'New inquiry received',
        subject: c.name,
        timestamp: c.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 15)

    res.json(events)
  } catch (err) {
    res
      .status(500)
      .json({ message: 'Failed to load recent activity', error: err.message })
  }
})

export default router
