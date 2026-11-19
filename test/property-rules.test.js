import test from 'node:test'
import assert from 'node:assert/strict'
import Property from '../src/models/Property.js'
import {
  PROPERTY_PURPOSES,
  PROPERTY_AVAILABILITIES,
  SALE_PROPERTY_TYPES,
  RENTAL_PROPERTY_TYPES,
  PROPERTY_WRITABLE_FIELDS,
  normalizeAndValidateProperty,
  calculateEffectivePrice,
  serializeProperty,
} from '../src/utils/propertyRules.js'

const base = {
  title: '  Family home  ',
  description: '  Bright and spacious  ',
  price: 100,
  location: '  Westlands, Nairobi  ',
  type: 'Apartment',
}

test('exports the existing property taxonomy and a strict writable contract', () => {
  assert.deepEqual(PROPERTY_PURPOSES, ['sale', 'rent'])
  assert.deepEqual(PROPERTY_AVAILABILITIES, ['available', 'sold', 'rented'])
  assert.deepEqual(SALE_PROPERTY_TYPES, [
    'Apartment', 'Bungalow', 'Townhouse', 'Land', 'Maisonette', 'Office space',
  ])
  assert.deepEqual(RENTAL_PROPERTY_TYPES, ['Apartment', 'Bungalow', 'Townhouse', 'Land'])
  for (const field of ['listingPurpose', 'availability', 'offerPercent', 'features', 'location']) {
    assert.ok(PROPERTY_WRITABLE_FIELDS.includes(field))
  }
  for (const field of ['effectivePrice', 'listedBy', '_id', '__v', 'createdAt', 'updatedAt', 'purpose']) {
    assert.ok(!PROPERTY_WRITABLE_FIELDS.includes(field))
  }
})

test('applies sale, available, zero-offer defaults and trims required text', () => {
  const property = normalizeAndValidateProperty(base)
  assert.equal(property.listingPurpose, 'sale')
  assert.equal(property.availability, 'available')
  assert.equal(property.offerPercent, 0)
  assert.equal(property.title, 'Family home')
  assert.equal(property.description, 'Bright and spacious')
  assert.equal(property.location, 'Westlands, Nairobi')
  assert.deepEqual(property.features, [])
})

test('sale and rental availability and property types are listingPurpose-specific', () => {
  assert.equal(normalizeAndValidateProperty({ ...base, availability: 'sold' }).availability, 'sold')
  assert.equal(normalizeAndValidateProperty({ ...base, listingPurpose: 'rent', availability: 'rented' }).availability, 'rented')
  for (const type of SALE_PROPERTY_TYPES) {
    assert.equal(normalizeAndValidateProperty({ ...base, type }).type, type)
  }
  for (const type of RENTAL_PROPERTY_TYPES) {
    assert.equal(normalizeAndValidateProperty({ ...base, listingPurpose: 'rent', type }).type, type)
  }
  for (const availability of ['rented', 'invalid']) {
    assert.throws(() => normalizeAndValidateProperty({ ...base, availability }))
  }
  assert.throws(() => normalizeAndValidateProperty({ ...base, listingPurpose: 'rent', availability: 'sold' }))
  assert.throws(() => normalizeAndValidateProperty({ ...base, listingPurpose: 'rent', type: 'Maisonette' }))
  assert.throws(() => normalizeAndValidateProperty({ ...base, listingPurpose: 'lease' }))
})

test('price is finite and positive; discount is bounded to 99.99 with at most two decimals', () => {
  for (const price of [0, -1, NaN, Infinity, -Infinity, '100']) {
    assert.throws(() => normalizeAndValidateProperty({ ...base, price }), `price ${price}`)
  }
  for (const offerPercent of [-0.01, 100, 99.999, 1.234, NaN, Infinity, '5']) {
    assert.throws(() => normalizeAndValidateProperty({ ...base, offerPercent }), `offer ${offerPercent}`)
  }
  for (const offerPercent of [0, 0.01, 7.5, 99.99]) {
    assert.equal(normalizeAndValidateProperty({ ...base, offerPercent }).offerPercent, offerPercent)
  }
})

test('location is required and trimmed, while optional structured fields and coordinates are preserved', () => {
  const property = normalizeAndValidateProperty({
    ...base,
    location: '  Eldoret  ',
    county: '  Uasin Gishu ',
    constituency: '  Turbo ',
    ward: '  Kiplombe ',
    coordinates: [35.2698, 0.5143],
  })
  assert.equal(property.location, 'Eldoret')
  assert.equal(property.county, 'Uasin Gishu')
  assert.equal(property.constituency, 'Turbo')
  assert.equal(property.ward, 'Kiplombe')
  assert.deepEqual(property.coordinates, [35.2698, 0.5143])
  assert.throws(() => normalizeAndValidateProperty({ ...base, location: '  ' }))
  assert.throws(() => normalizeAndValidateProperty({ ...base, coordinates: [181, 0] }))
  assert.throws(() => normalizeAndValidateProperty({ ...base, coordinates: [1] }))
})

test('features and images remain string snapshots; unknown and server fields are rejected', () => {
  const property = normalizeAndValidateProperty({
    ...base,
    features: ['Pool', 'Garden'],
    images: ['https://images.example.test/home.jpg'],
  })
  assert.deepEqual(property.features, ['Pool', 'Garden'])
  assert.deepEqual(property.images, ['https://images.example.test/home.jpg'])
  for (const field of ['effectivePrice', 'listedBy', '_id', '__v', 'createdAt', 'unknownField']) {
    assert.throws(() => normalizeAndValidateProperty({ ...base, [field]: 12 }), field)
  }
  assert.throws(() => normalizeAndValidateProperty({ ...base, features: [{ id: 'pool' }] }))
  assert.throws(() => normalizeAndValidateProperty({ ...base, images: [4] }))
  assert.throws(() => normalizeAndValidateProperty({ ...base, purpose: 'rent' }))
})

test('partial edits merge and fully validate legacy records and require explicit compatible status changes', () => {
  const existing = {
    _id: 'legacy', title: 'Legacy home', description: 'Description', price: 200,
    type: 'Apartment', availability: 'sold', listingPurpose: 'sale', offerPercent: 0,
    features: ['Pool'], county: 'Kiambu', constituency: 'Ruiru', ward: 'Gitothua',
  }
  const changed = normalizeAndValidateProperty({ description: 'Updated description' }, { existing })
  assert.equal(changed.title, existing.title)
  assert.equal(changed.price, existing.price)
  assert.equal(changed.description, 'Updated description')
  assert.equal(changed.availability, 'sold')
  assert.throws(() => normalizeAndValidateProperty({ listingPurpose: 'rent' }, { existing }))
  const converted = normalizeAndValidateProperty(
    { listingPurpose: 'rent', availability: 'rented' }, { existing },
  )
  assert.equal(converted.listingPurpose, 'rent')
  assert.equal(converted.availability, 'rented')
  assert.equal(converted.location, 'Gitothua, Ruiru, Kiambu')
  assert.throws(() => normalizeAndValidateProperty({ price: 0 }, { existing }))
})

test('effectivePrice and legacy defaults are projected without changing raw stored data', () => {
  const legacyRecord = {
    _id: 'legacy', title: 'Legacy home', price: 100,
    type: 'Apartment', county: 'Kiambu', constituency: 'Ruiru', ward: 'Gitothua',
  }
  const result = serializeProperty(legacyRecord)
  assert.equal(result.location, 'Gitothua, Ruiru, Kiambu')
  assert.equal(result.listingPurpose, 'sale')
  assert.equal(result.availability, 'available')
  assert.equal(result.offerPercent, 0)
  assert.equal(result.effectivePrice, 100)
  for (const field of ['listingPurpose', 'availability', 'offerPercent']) {
    assert.equal(Object.hasOwn(legacyRecord, field), false)
  }

  const discounted = serializeProperty({ price: 100, offerPercent: 7.5 })
  assert.equal(discounted.effectivePrice, 92.5)
  assert.equal(serializeProperty({ price: 0.1, offerPercent: 5 }).effectivePrice, 0.1)

  const historical = serializeProperty({
    price: 100, listingPurpose: null, availability: 'withdrawn', offerPercent: 100,
  })
  assert.equal(historical.listingPurpose, null)
  assert.equal(historical.availability, 'withdrawn')
  assert.equal(historical.offerPercent, 100)
  assert.equal(historical.effectivePrice, null)
})

test('money rounds decimal half-cents consistently without overflowing finite prices', () => {
  assert.equal(calculateEffectivePrice(10.075, 0), 10.08)
  assert.equal(calculateEffectivePrice(100.5, 99), 1.01)
  assert.equal(calculateEffectivePrice(Number.MAX_VALUE, 0), Number.MAX_VALUE)
})

test('Mongoose model enables optimistic concurrency for merged validation', () => {
  assert.equal(Property.schema.options.optimisticConcurrency, true)
})

test('Mongoose model enforces the same price, listingPurpose/status/type and discount invariants', async () => {
  const valid = normalizeAndValidateProperty(base)
  const modelDoc = new Property(valid)
  await modelDoc.validate()
  assert.equal(modelDoc.listingPurpose, 'sale')
  assert.equal(modelDoc.availability, 'available')
  assert.equal(modelDoc.effectivePrice, 100)
  assert.equal(Property.schema.path('listingPurpose').options.default, 'sale')
  assert.equal(Property.schema.path('purpose'), undefined)

  for (const invalid of [
    { ...valid, price: 0 },
    { ...valid, listingPurpose: null },
    { ...valid, availability: null },
    { ...valid, offerPercent: null },
    { ...valid, offerPercent: 100 },
    { ...valid, offerPercent: 3.141 },
    { ...valid, listingPurpose: 'rent', availability: 'sold' },
    { ...valid, listingPurpose: 'rent', type: 'Maisonette' },
    { ...valid, location: '   ' },
  ]) {
    await assert.rejects(new Property(invalid).validate())
  }
})
