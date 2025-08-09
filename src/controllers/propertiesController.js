import Property from '../models/Property.js'

export const getAllProperties = async (req, res) => {
  try {
    const properties = await Property.find()
    res.json(properties)
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message })
  }
}

export const getPropertyById = async (req, res) => {
  try {
    const property = await Property.findById(req.params.id)
    if (!property)
      return res.status(404).json({ message: 'Property not found' })
    res.json(property)
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message })
  }
}

export const createProperty = async (req, res) => {
  try {
    const property = await Property.create(req.body)
    res.status(201).json(property)
  } catch (err) {
    res.status(400).json({ message: 'Invalid data', error: err.message })
  }
}

export const updateProperty = async (req, res) => {
  try {
    const property = await Property.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    })
    if (!property)
      return res.status(404).json({ message: 'Property not found' })
    res.json(property)
  } catch (err) {
    res.status(400).json({ message: 'Invalid data', error: err.message })
  }
}

export const deleteProperty = async (req, res) => {
  try {
    const property = await Property.findByIdAndDelete(req.params.id)
    if (!property)
      return res.status(404).json({ message: 'Property not found' })
    res.json({ message: 'Property deleted' })
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message })
  }
}
