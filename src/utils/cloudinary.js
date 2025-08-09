import { v2 as cloudinary } from 'cloudinary'

export const configureCloudinary = (config) => {
  cloudinary.config(config)
  return cloudinary
}
