import Property from '../models/Property.js'
import {
  normalizeAndValidateProperty,
  PropertyInputError,
  serializeProperty,
} from '../utils/propertyRules.js'

function leanIfSupported(query) {
  return typeof query?.lean === 'function' ? query.lean() : query
}

function isInputError(error) {
  return error instanceof PropertyInputError ||
    ['ValidationError', 'CastError', 'StrictModeError'].includes(error?.name)
}

function invalidData(res, error) {
  return res.status(400).json({ message: 'Invalid data', error: error.message })
}

export const getAllProperties = async (req, res) => {
  try {
    const properties = await leanIfSupported(Property.find())
    res.json(properties.map(serializeProperty))
  } catch {
    res.status(500).json({ message: 'Unable to load properties' })
  }
}

export const getPropertyById = async (req, res) => {
  try {
    const property = await leanIfSupported(Property.findById(req.params.id))
    if (!property) return res.status(404).json({ message: 'Property not found' })
    res.json(serializeProperty(property))
  } catch {
    res.status(500).json({ message: 'Unable to load property' })
  }
}

export const createProperty = async (req, res) => {
  let normalized
  try {
    normalized = normalizeAndValidateProperty(req.body)
  } catch (error) {
    return invalidData(res, error)
  }

  try {
    const property = await Property.create(normalized)
    res.status(201).json(serializeProperty(property))
  } catch (error) {
    if (isInputError(error)) return invalidData(res, error)
    res.status(500).json({ message: 'Unable to create property' })
  }
}

export const updateProperty = async (req, res) => {
  let existing
  try {
    existing = await leanIfSupported(Property.findById(req.params.id))
  } catch {
    return res.status(500).json({ message: 'Unable to load property' })
  }
  if (!existing) return res.status(404).json({ message: 'Property not found' })

  try {
    const normalized = normalizeAndValidateProperty(req.body, { existing })
    const property = Property.hydrate(existing)
    // Imported legacy documents may lack __v. Fence that first edit too;
    // Mongoose increments the version on save but otherwise omits its predicate.
    if (existing.__v === undefined) property.$where = { __v: { $exists: false } }
    property.set(normalized)
    await property.validate()
    const saved = await property.save()
    res.json(serializeProperty(saved))
  } catch (error) {
    if (error?.name === 'VersionError') {
      return res.status(409).json({ message: 'Property changed; reload before updating' })
    }
    if (isInputError(error)) return invalidData(res, error)
    res.status(500).json({ message: 'Unable to update property' })
  }
}

export const deleteProperty = async (req, res) => {
  try {
    const property = await Property.findByIdAndDelete(req.params.id)
    if (!property) return res.status(404).json({ message: 'Property not found' })
    res.json({ message: 'Property deleted' })
  } catch {
    res.status(500).json({ message: 'Unable to delete property' })
  }
}
