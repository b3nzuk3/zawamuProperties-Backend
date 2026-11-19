import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth.js'
import propertiesRoutes from './routes/properties.js'
import blogRoutes from './routes/blog.js'
import contactRoutes from './routes/contact.js'
import adminRoutes from './routes/admin.js'
import analyticsRoutes from './routes/analytics.js'
import uploadRoutes from './routes/upload.js'
import viewingRoutes from './routes/viewing.js'
import savedSearchesRoutes from './routes/savedSearches.js'
import featuresRoutes from './routes/features.js'
import { contactSubmissionRateLimiter } from './middleware/contactRateLimiter.js'

const app = express()

const trustedProxyHopsText = process.env.TRUST_PROXY_HOPS
if (trustedProxyHopsText !== undefined && trustedProxyHopsText !== '') {
  if (!/^\d+$/.test(trustedProxyHopsText) || Number(trustedProxyHopsText) > 10) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 through 10')
  }
}
// Trust only an explicitly configured fixed number of proxy hops; never `true`.
app.set('trust proxy', trustedProxyHopsText ? Number(trustedProxyHopsText) : 0)

// Middleware
app.use('/api/contact', (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})
app.use(cors())
app.use('/api/contact', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/') return contactSubmissionRateLimiter(req, res, next)
  next()
})
app.use(express.json())

// Root route
app.get('/', (req, res) => {
  res.send('Zawamu Properties API is running')
})

// API routes
app.use('/api/auth', authRoutes)
app.use('/api/properties', propertiesRoutes)
app.use('/api/blog', blogRoutes)
app.use('/api/contact', contactRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/viewing-requests', viewingRoutes)
app.use('/api/saved-searches', savedSearchesRoutes)
app.use('/api/features', featuresRoutes)

app.use('/api/contact', (error, _req, res, next) => {
  if (error instanceof SyntaxError && Object.hasOwn(error, 'body')) {
    return res.status(400).json({ message: 'Invalid enquiry request' })
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Enquiry request is too large' })
  }
  return next(error)
})

export default app
