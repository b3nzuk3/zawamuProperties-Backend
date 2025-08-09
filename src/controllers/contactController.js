import Contact from '../models/Contact.js'

export const submitContact = async (req, res) => {
  try {
    const { name, email, message } = req.body
    if (!name || !email || !message) {
      return res.status(400).json({ message: 'All fields are required' })
    }
    await Contact.create({ name, email, message })
    res.status(201).json({ message: 'Contact form submitted successfully' })
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message })
  }
}
