import dotenv from 'dotenv'
import mongoose from 'mongoose'

dotenv.config()

// Import after dotenv so upload configuration sees startup environment.
const { default: app } = await import('./app.js')
const PORT = process.env.PORT || 5000

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log('Connected to MongoDB')
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err)
  })
