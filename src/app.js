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

const app = express()

// Middleware
app.use(cors())
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

export default app
