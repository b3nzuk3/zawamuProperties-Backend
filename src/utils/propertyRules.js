export const PROPERTY_PURPOSES = Object.freeze(['sale', 'rent'])
export const PROPERTY_AVAILABILITIES = Object.freeze(['available', 'sold', 'rented'])
export const SALE_PROPERTY_TYPES = Object.freeze([
  'Apartment',
  'Bungalow',
  'Townhouse',
  'Land',
  'Maisonette',
  'Office space',
])
export const RENTAL_PROPERTY_TYPES = Object.freeze([
  'Apartment',
  'Bungalow',
  'Townhouse',
  'Land',
])

export const PROPERTY_WRITABLE_FIELDS = Object.freeze([
  'title',
  'description',
  'price',
  'location',
  'county',
  'constituency',
  'ward',
  'coordinates',
  'type',
  'listingPurpose',
  'availability',
  'offerPercent',
  'featured',
  'images',
  'features',
  'bedrooms',
  'bathrooms',
  'area',
])

const writableFieldSet = new Set(PROPERTY_WRITABLE_FIELDS)
const stringFields = ['title', 'description', 'location', 'county', 'constituency', 'ward', 'type']
const nonNegativeNumberFields = ['bedrooms', 'bathrooms', 'area']
const defaults = {
  listingPurpose: 'sale',
  availability: 'available',
  offerPercent: 0,
  featured: false,
  images: [],
  features: [],
  bedrooms: 0,
  bathrooms: 0,
  area: 0,
  coordinates: null,
}

export class PropertyInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PropertyInputError'
  }
}

export function isAvailabilityCompatible(listingPurpose, availability) {
  if (listingPurpose === 'sale') return availability === 'available' || availability === 'sold'
  if (listingPurpose === 'rent') return availability === 'available' || availability === 'rented'
  return false
}

export function isPropertyTypeAllowed(listingPurpose, type) {
  const allowed = listingPurpose === 'rent' ? RENTAL_PROPERTY_TYPES : SALE_PROPERTY_TYPES
  return allowed.includes(type)
}

function fail(message) {
  throw new PropertyInputError(message)
}

function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function structuredLocation(property) {
  return ['ward', 'constituency', 'county']
    .map(field => typeof property[field] === 'string' ? property[field].trim() : '')
    .filter(Boolean)
    .join(', ')
}

function hasAtMostTwoDecimalPlaces(value) {
  return Number(value.toFixed(2)) === value
}

function validateCoordinates(value) {
  if (value === null) return
  if (!Array.isArray(value) || value.length !== 2) {
    fail('coordinates must be null or [longitude, latitude]')
  }
  const [longitude, latitude] = value
  if (
    typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
  ) {
    fail('coordinates must contain valid [longitude, latitude] values')
  }
}

function validateStringArray(value, field) {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    fail(`${field} must be an array of strings`)
  }
}

/** Validate writable input and return the full normalized document candidate. */
export function normalizeAndValidateProperty(input, { existing } = {}) {
  if (!isObjectRecord(input)) fail('property body must be an object')

  const unknown = Object.keys(input).filter(field => !writableFieldSet.has(field))
  if (unknown.length) fail(`unsupported property field(s): ${unknown.join(', ')}`)

  const current = existing == null ? {} : existing
  if (!isObjectRecord(current)) fail('existing property must be an object')
  const candidate = { ...current, ...input }

  for (const [field, defaultValue] of Object.entries(defaults)) {
    if (!Object.hasOwn(input, field) && candidate[field] === undefined) {
      candidate[field] = Array.isArray(defaultValue) ? [...defaultValue] : defaultValue
    }
  }

  for (const field of stringFields) {
    if (candidate[field] === undefined || candidate[field] === null) continue
    if (typeof candidate[field] !== 'string') fail(`${field} must be a string`)
    candidate[field] = candidate[field].trim()
  }

  if (Object.hasOwn(input, 'location')) {
    if (typeof input.location !== 'string' || input.location.trim() === '') {
      fail('location is required')
    }
    candidate.location = input.location.trim()
  } else if (typeof candidate.location !== 'string' || candidate.location.trim() === '') {
    if (existing != null) candidate.location = structuredLocation(candidate)
  }
  if (typeof candidate.location !== 'string' || candidate.location.trim() === '') {
    fail('location is required')
  }
  candidate.location = candidate.location.trim()

  if (!candidate.title) fail('title is required')
  if (!candidate.description) fail('description is required')
  if (typeof candidate.price !== 'number' || !Number.isFinite(candidate.price) || candidate.price <= 0) {
    fail('price must be a finite number greater than zero')
  }

  if (!PROPERTY_PURPOSES.includes(candidate.listingPurpose)) fail('listingPurpose must be sale or rent')
  if (!PROPERTY_AVAILABILITIES.includes(candidate.availability)) {
    fail('availability must be available, sold, or rented')
  }
  if (!isAvailabilityCompatible(candidate.listingPurpose, candidate.availability)) {
    fail(`availability ${candidate.availability} is incompatible with listingPurpose ${candidate.listingPurpose}`)
  }
  if (!isPropertyTypeAllowed(candidate.listingPurpose, candidate.type)) {
    fail(`type ${candidate.type} is not allowed for listingPurpose ${candidate.listingPurpose}`)
  }

  if (
    typeof candidate.offerPercent !== 'number' || !Number.isFinite(candidate.offerPercent) ||
    candidate.offerPercent < 0 || candidate.offerPercent > 99.99 ||
    !hasAtMostTwoDecimalPlaces(candidate.offerPercent)
  ) {
    fail('offerPercent must be a finite percentage from 0 to 99.99 with at most two decimals')
  }

  for (const field of nonNegativeNumberFields) {
    if (typeof candidate[field] !== 'number' || !Number.isFinite(candidate[field]) || candidate[field] < 0) {
      fail(`${field} must be a finite non-negative number`)
    }
  }
  if (typeof candidate.featured !== 'boolean') fail('featured must be a boolean')
  validateStringArray(candidate.images, 'images')
  validateStringArray(candidate.features, 'features')
  validateCoordinates(candidate.coordinates)

  return candidate
}

export function calculateEffectivePrice(price, offerPercent = 0) {
  if (
    typeof price !== 'number' || !Number.isFinite(price) || price <= 0 ||
    typeof offerPercent !== 'number' || !Number.isFinite(offerPercent) ||
    offerPercent < 0 || offerPercent > 99.99 || !hasAtMostTwoDecimalPlaces(offerPercent)
  ) return null
  // Calculate from decimal representations, not binary half-cent approximations.
  const [mantissa, exponent = '0'] = String(price).toLowerCase().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const scale = fraction.length - Number(exponent)
  const coefficient = BigInt(whole + fraction)
  const discountBasisPoints = BigInt(Math.round(offerPercent * 100))
  let numerator = coefficient * (10000n - discountBasisPoints)
  let denominator = 100n
  if (scale >= 0) denominator *= 10n ** BigInt(scale)
  else numerator *= 10n ** BigInt(-scale)
  const cents = (numerator + denominator / 2n) / denominator
  // Avoid converting the intermediate cents to Number (which may overflow).
  return Number(`${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`)
}

/** Project a raw/lean record without applying Mongoose defaults to legacy rows. */
export function serializeProperty(property) {
  if (!isObjectRecord(property) && typeof property?.toObject !== 'function') return property
  const source = typeof property.toObject === 'function'
    ? property.toObject({ virtuals: false, transform: false })
    : property
  const result = { ...source }
  const location = typeof result.location === 'string' ? result.location.trim() : ''
  result.location = location || structuredLocation(result)
  if (result.listingPurpose === undefined) result.listingPurpose = 'sale'
  if (result.availability === undefined) result.availability = 'available'
  if (result.offerPercent === undefined) result.offerPercent = 0
  result.effectivePrice = calculateEffectivePrice(result.price, result.offerPercent)
  return result
}
