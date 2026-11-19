// Capability is derived only from the persisted user's email and server config.
export function isConfiguredOwner(user) {
  if (typeof user?.email !== 'string') return false
  const email = user.email.trim().toLowerCase()
  if (!email) return false
  return (process.env.ADMIN_EMAILS || '').split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(email)
}

export function userDto(user) {
  return { id: user._id, name: user.name, email: user.email, isAdmin: isConfiguredOwner(user) }
}
