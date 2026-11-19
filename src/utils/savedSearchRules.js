import { serializeProperty } from './propertyRules.js'

export const SAVED_SEARCH_CRITERIA_FIELDS = Object.freeze([
  'location',
  'county',
  'constituency',
  'ward',
  'listingPurpose',
  'propertyTypes',
  'minPrice',
  'maxPrice',
  'minBedrooms',
  'maxBedrooms',
  'minBathrooms',
  'maxBathrooms',
  'searchTerm',
])

export const SAVED_SEARCH_PROPERTY_TYPES = Object.freeze([
  'Apartment',
  'Bungalow',
  'Townhouse',
  'Land',
  'Maisonette',
  'Office space',
  // Historical client values. house/commercial stay exact literal matches.
  'apartment',
  'land',
  'office',
  'house',
  'commercial',
])

const criterionKeys = new Set(SAVED_SEARCH_CRITERIA_FIELDS)
const allowedPropertyTypes = new Set(SAVED_SEARCH_PROPERTY_TYPES)
const legacyTypeAliases = new Map([
  ['apartment', 'Apartment'],
  ['land', 'Land'],
  ['office', 'Office space'],
])
const normalizeTypeAlias = type => legacyTypeAliases.get(type) ?? type
const textFields = ['location', 'county', 'constituency', 'ward', 'searchTerm']
const numericFields = [
  'minPrice', 'maxPrice', 'minBedrooms', 'maxBedrooms', 'minBathrooms', 'maxBathrooms',
]
const numericRanges = [
  ['minPrice', 'maxPrice'],
  ['minBedrooms', 'maxBedrooms'],
  ['minBathrooms', 'maxBathrooms'],
]
const maxTextLength = 200

export class SavedSearchCriteriaError extends TypeError {
  constructor(message) {
    super(message)
    this.name = 'SavedSearchCriteriaError'
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function criteriaObject(value) {
  if (typeof value?.toObject === 'function') {
    return value.toObject({ virtuals: false, transform: false })
  }
  return value
}

/** Validate new API input without coercing types or mutating the caller's object. */
export function validateSavedSearchCriteria(value) {
  if (!isRecord(value)) throw new SavedSearchCriteriaError('searchCriteria must be an object')

  const unknown = Object.keys(value).filter(key => !criterionKeys.has(key))
  if (unknown.length) {
    throw new SavedSearchCriteriaError(`unsupported search criteria field(s): ${unknown.join(', ')}`)
  }

  const result = {}
  for (const field of textFields) {
    if (!Object.hasOwn(value, field) || value[field] === undefined) continue
    if (typeof value[field] !== 'string') {
      throw new SavedSearchCriteriaError(`${field} must be a string`)
    }
    const normalized = value[field].trim()
    if (normalized.length > maxTextLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new SavedSearchCriteriaError(`${field} is invalid or too long`)
    }
    // Historical browse forms used this sentinel for an unbounded county.
    // Other structured constraints remain independently enforced.
    if (field === 'county' && normalized.toLowerCase() === 'all') continue
    if (normalized) result[field] = normalized
  }

  if (Object.hasOwn(value, 'listingPurpose') && value.listingPurpose !== undefined) {
    if (!['sale', 'rent'].includes(value.listingPurpose)) {
      throw new SavedSearchCriteriaError('listingPurpose must be sale or rent')
    }
    result.listingPurpose = value.listingPurpose
  }

  if (Object.hasOwn(value, 'propertyTypes') && value.propertyTypes !== undefined) {
    if (!Array.isArray(value.propertyTypes) || value.propertyTypes.some(type => typeof type !== 'string')) {
      throw new SavedSearchCriteriaError('propertyTypes must be an array of strings')
    }
    for (const type of value.propertyTypes) {
      if (!allowedPropertyTypes.has(type)) {
        throw new SavedSearchCriteriaError(`unsupported property type: ${type}`)
      }
    }
    result.propertyTypes = [...value.propertyTypes]
  }

  for (const field of numericFields) {
    if (!Object.hasOwn(value, field) || value[field] === undefined) continue
    const amount = value[field]
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new SavedSearchCriteriaError(`${field} must be a finite non-negative number`)
    }
    result[field] = amount
  }

  for (const [minimum, maximum] of numericRanges) {
    if (Object.hasOwn(result, minimum) && Object.hasOwn(result, maximum) && result[minimum] > result[maximum]) {
      throw new SavedSearchCriteriaError(`${minimum} cannot exceed ${maximum}`)
    }
  }

  return result
}

function normalizedSearchTerm(criteria) {
  return typeof criteria?.searchTerm === 'string' ? criteria.searchTerm.trim().toLowerCase() : ''
}

function matchesTextConstraint(expected, actual) {
  if (expected === undefined || expected === null || expected === '') return true
  return typeof actual === 'string' && actual.trim() !== '' &&
    expected.trim().toLowerCase() === actual.trim().toLowerCase()
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Shared, fail-closed saved-search predicate for HTTP results and model matchesProperty. */
export function matchesSavedSearchProperty(criteriaValue, propertyValue) {
  let criteria
  try {
    criteria = validateSavedSearchCriteria(criteriaObject(criteriaValue))
  } catch {
    return false
  }
  if (!isRecord(criteria)) return false

  const property = serializeProperty(propertyValue)
  if (!isRecord(property)) return false

  for (const field of ['county', 'constituency', 'ward']) {
    if (!matchesTextConstraint(criteria[field], property[field])) return false
  }

  if (typeof criteria.location === 'string' && criteria.location.trim()) {
    const location = typeof property.location === 'string' ? property.location : ''
    if (!location.toLowerCase().includes(criteria.location.trim().toLowerCase())) return false
  }

  // A legacy property without listingPurpose is a sale listing at read time.
  if (criteria.listingPurpose && criteria.listingPurpose !== property.listingPurpose) return false

  if (Array.isArray(criteria.propertyTypes) && criteria.propertyTypes.length > 0) {
    // Normalize only these three exact historical lowercase aliases on both sides.
    // Legacy house/commercial values remain literal; neither maps to a new category.
    const requestedTypes = criteria.propertyTypes.map(normalizeTypeAlias)
    if (!requestedTypes.includes(normalizeTypeAlias(property.type))) return false
  }

  const hasPriceBounds = Object.hasOwn(criteria, 'minPrice') || Object.hasOwn(criteria, 'maxPrice')
  if (hasPriceBounds) {
    const effectivePrice = property.effectivePrice
    if (!isFiniteNumber(effectivePrice)) return false
    if (Object.hasOwn(criteria, 'minPrice') && effectivePrice < criteria.minPrice) return false
    if (Object.hasOwn(criteria, 'maxPrice') && effectivePrice > criteria.maxPrice) return false
  }

  for (const [minimum, maximum, field] of [
    ['minBedrooms', 'maxBedrooms', 'bedrooms'],
    ['minBathrooms', 'maxBathrooms', 'bathrooms'],
  ]) {
    const hasMinimum = Object.hasOwn(criteria, minimum)
    const hasMaximum = Object.hasOwn(criteria, maximum)
    if (!hasMinimum && !hasMaximum) continue
    // Hydration applies schema defaults even when the stored legacy field is
    // absent. A defaulted zero is not evidence of a known bedroom/bathroom count.
    if (typeof propertyValue?.$isDefault === 'function' && propertyValue.$isDefault(field)) return false
    if (!isFiniteNumber(property[field])) return false
    if (hasMinimum && property[field] < criteria[minimum]) return false
    if (hasMaximum && property[field] > criteria[maximum]) return false
  }

  const term = normalizedSearchTerm(criteria)
  if (term) {
    const searchableText = [property.title, property.description, property.location]
      .filter(value => typeof value === 'string')
      .join(' ')
      .toLowerCase()
    if (!searchableText.includes(term)) return false
  }

  return true
}
