import nodemailer from 'nodemailer'

function parseSmtpConfig(env = process.env) {
  const host = env.SMTP_HOST?.trim()
  const portText = env.SMTP_PORT?.trim()
  const port = portText && /^\d+$/.test(portText) ? Number(portText) : NaN
  const user = env.SMTP_USER?.trim()
  const password = env.SMTP_PASSWORD
  const secureText = env.SMTP_SECURE?.trim().toLowerCase()
  const secure = secureText === '' || secureText === undefined
    ? port === 465
    : secureText === 'true'
      ? true
      : secureText === 'false'
        ? false
        : null

  if (!host || /\s/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || secure === null) return null
  if (Boolean(user) !== Boolean(password)) return null

  const options = {
    host,
    port,
    secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  }
  if (user && password) options.auth = { user, pass: password }
  return { options, from: env.SMTP_FROM?.trim() || '' }
}

export function getSmtpConfiguration(env = process.env) {
  return parseSmtpConfig(env)
}

export function createSmtpTransporter(env = process.env) {
  const configuration = parseSmtpConfig(env)
  return configuration ? nodemailer.createTransport(configuration.options) : null
}
