import User from '../models/User.js'
import { isConfiguredOwner } from '../utils/ownerCapability.js'

const adminMiddleware = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId)
    if (!isConfiguredOwner(user)) {
      return res.status(403).json({ message: 'Owner access required' })
    }
    next()
  } catch {
    return res.status(500).json({ message: 'Unable to verify owner access' })
  }
}

export default adminMiddleware
