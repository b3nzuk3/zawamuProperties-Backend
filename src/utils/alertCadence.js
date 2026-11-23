const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DAILY_HOUR = 9

function asValidDate(value, name) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${name} must be a valid Date`)
  }
  return value
}

function localParts(date) {
  const shifted = new Date(date.getTime() + NAIROBI_OFFSET_MS)
  const localMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  )
  return { shifted, localMidnight }
}

function localSlotToUtc(localMidnight, hour, dayOffset = 0) {
  return new Date(localMidnight + dayOffset * DAY_MS + hour * 60 * 60 * 1000 - NAIROBI_OFFSET_MS)
}

function initialDailySlot(now) {
  const { localMidnight } = localParts(now)
  return localSlotToUtc(localMidnight, DAILY_HOUR)
}

function initialWeeklySlot(now) {
  const { shifted, localMidnight } = localParts(now)
  const daysUntilMonday = (8 - shifted.getUTCDay()) % 7
  const mondayMidnight = localMidnight + daysUntilMonday * DAY_MS
  const mondaySlot = localSlotToUtc(mondayMidnight, DAILY_HOUR)
  if (daysUntilMonday === 0 && shifted.getTime() >= localMidnight + DAILY_HOUR * 60 * 60 * 1000) {
    return mondaySlot
  }
  return daysUntilMonday === 0 ? localSlotToUtc(mondayMidnight, DAILY_HOUR, 7) : mondaySlot
}

function dailySlotAfter(reference) {
  const { shifted, localMidnight } = localParts(reference)
  const todayLocalSlot = localMidnight + DAILY_HOUR * 60 * 60 * 1000
  const dayOffset = shifted.getTime() < todayLocalSlot ? 0 : 1
  return localSlotToUtc(localMidnight, DAILY_HOUR, dayOffset)
}

function mondaySlotAfter(reference) {
  const { shifted, localMidnight } = localParts(reference)
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7
  const mondayMidnight = localMidnight - daysSinceMonday * DAY_MS
  const thisMondaySlotLocal = mondayMidnight + DAILY_HOUR * 60 * 60 * 1000
  const weeks = shifted.getTime() < thisMondaySlotLocal ? 0 : 1
  return localSlotToUtc(mondayMidnight, DAILY_HOUR, weeks * 7)
}

/** Return the first cadence boundary after last send, or the active/upcoming one if none. */
export function getNextCadenceAt(frequency, lastSentAt, now = new Date()) {
  asValidDate(now, 'now')
  if (!['immediate', 'daily', 'weekly'].includes(frequency)) {
    throw new TypeError('frequency must be immediate, daily, or weekly')
  }
  if (frequency === 'immediate') return new Date(now)
  if (lastSentAt !== null && lastSentAt !== undefined) asValidDate(lastSentAt, 'lastSentAt')
  if (frequency === 'daily') {
    return lastSentAt ? dailySlotAfter(lastSentAt) : initialDailySlot(now)
  }
  return lastSentAt ? mondaySlotAfter(lastSentAt) : initialWeeklySlot(now)
}

export function isCadenceDue(frequency, lastSentAt, now = new Date()) {
  asValidDate(now, 'now')
  if (frequency === 'immediate') return true
  const nextAt = getNextCadenceAt(frequency, lastSentAt, now)
  return now.getTime() >= nextAt.getTime()
}

/** The UTC instant at which the current Africa/Nairobi calendar day began. */
export function getNairobiDayStart(now = new Date()) {
  asValidDate(now, 'now')
  const { localMidnight } = localParts(now)
  return new Date(localMidnight - NAIROBI_OFFSET_MS)
}
