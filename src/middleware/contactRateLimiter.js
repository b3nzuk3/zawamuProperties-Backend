import { rateLimit } from 'express-rate-limit'

export const contactSubmissionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({ message: 'Too many enquiries. Please try again later.' })
  },
})
