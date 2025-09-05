import ViewingRequest from '../models/ViewingRequest.js'
import Property from '../models/Property.js'

export const createViewingRequest = async (req, res) => {
  try {
    const {
      propertyId,
      propertyTitle,
      name,
      email,
      phone,
      preferredDate,
      preferredTime,
      message,
    } = req.body

    // Verify property exists
    const property = await Property.findById(propertyId)
    if (!property) {
      return res.status(404).json({ message: 'Property not found' })
    }

    const viewingRequest = await ViewingRequest.create({
      propertyId,
      propertyTitle,
      name,
      email,
      phone,
      preferredDate: new Date(preferredDate),
      preferredTime,
      message,
    })

    res.status(201).json({
      message: 'Viewing request submitted successfully',
      viewingRequest,
    })
  } catch (err) {
    res.status(400).json({
      message: 'Invalid data',
      error: err.message,
    })
  }
}

export const getAllViewingRequests = async (req, res) => {
  try {
    const viewingRequests = await ViewingRequest.find()
      .populate('propertyId', 'title location price')
      .sort({ createdAt: -1 })

    res.json(viewingRequests)
  } catch (err) {
    res.status(500).json({
      message: 'Server error',
      error: err.message,
    })
  }
}

export const getViewingRequestById = async (req, res) => {
  try {
    const viewingRequest = await ViewingRequest.findById(
      req.params.id
    ).populate('propertyId', 'title location price images')

    if (!viewingRequest) {
      return res.status(404).json({ message: 'Viewing request not found' })
    }

    res.json(viewingRequest)
  } catch (err) {
    res.status(500).json({
      message: 'Server error',
      error: err.message,
    })
  }
}

export const updateViewingRequestStatus = async (req, res) => {
  try {
    const { status, notes } = req.body

    const viewingRequest = await ViewingRequest.findByIdAndUpdate(
      req.params.id,
      { status, notes },
      { new: true }
    )

    if (!viewingRequest) {
      return res.status(404).json({ message: 'Viewing request not found' })
    }

    res.json({
      message: 'Viewing request updated successfully',
      viewingRequest,
    })
  } catch (err) {
    res.status(400).json({
      message: 'Invalid data',
      error: err.message,
    })
  }
}

export const deleteViewingRequest = async (req, res) => {
  try {
    const viewingRequest = await ViewingRequest.findByIdAndDelete(req.params.id)

    if (!viewingRequest) {
      return res.status(404).json({ message: 'Viewing request not found' })
    }

    res.json({ message: 'Viewing request deleted successfully' })
  } catch (err) {
    res.status(500).json({
      message: 'Server error',
      error: err.message,
    })
  }
}
