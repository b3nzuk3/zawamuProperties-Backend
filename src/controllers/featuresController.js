import Feature from '../models/Feature.js'
import { normalizeFeatureName } from '../utils/featureRules.js'

function featureDto(feature) {
  return { _id: feature._id, name: feature.name }
}

export async function getFeatures(req, res) {
  try {
    const features = await Feature.find().sort({ nameKey: 1, _id: 1 })
    return res.json(features.map(featureDto))
  } catch {
    return res.status(500).json({ message: 'Unable to load features' })
  }
}

export async function createFeature(req, res) {
  if (
    !req.body ||
    typeof req.body !== 'object' ||
    Array.isArray(req.body) ||
    Object.keys(req.body).length !== 1 ||
    !Object.hasOwn(req.body, 'name')
  ) {
    return res.status(400).json({ message: 'Invalid feature input' })
  }

  let normalized
  try {
    normalized = normalizeFeatureName(req.body.name)
  } catch {
    return res.status(400).json({ message: 'Invalid feature input' })
  }

  try {
    const existing = await Feature.findOne({ nameKey: normalized.nameKey })
    if (existing) return res.status(200).json(featureDto(existing))

    const feature = await Feature.create(normalized)
    return res.status(201).json(featureDto(feature))
  } catch (error) {
    if (error?.code === 11000) {
      try {
        const existing = await Feature.findOne({ nameKey: normalized.nameKey })
        if (existing) return res.status(200).json(featureDto(existing))
      } catch {
        // Return the same generic storage failure if the race reread fails.
      }
    }
    return res.status(500).json({ message: 'Unable to save feature' })
  }
}
