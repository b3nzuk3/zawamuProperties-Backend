export const MAX_FEATURE_NAME_LENGTH = 100

export function normalizeFeatureName(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Feature name must be a string')
  }

  const name = value.trim().replace(/\s+/gu, ' ')
  if (!name) {
    throw new RangeError('Feature name is required')
  }
  if ([...name].length > MAX_FEATURE_NAME_LENGTH) {
    throw new RangeError(`Feature name must be ${MAX_FEATURE_NAME_LENGTH} characters or fewer`)
  }

  return { name, nameKey: name.toLowerCase() }
}
