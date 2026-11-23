import { getSmtpConfiguration } from './smtpTransport.js'
import { getTrustedFrontendOrigin } from './contactRules.js'

const APPROVED_EMAIL = 'zawamuproperty@gmail.com'
const isMailbox = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)

// This function only inspects supplied configuration. It neither loads .env nor
// contacts databases/providers, and deliberately never returns secret values.
export function checkReleaseConfiguration(env = process.env) {
  const checks = {}
  const owners = typeof env.ADMIN_EMAILS === 'string'
    ? env.ADMIN_EMAILS.split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
    : []
  checks.approved_owner_allowlist = owners.includes(APPROVED_EMAIL) && owners.every(isMailbox)
  checks.approved_enquiry_recipient = env.CONTACT_NOTIFICATION_EMAIL?.trim().toLowerCase() === APPROVED_EMAIL
  const origin = getTrustedFrontendOrigin(env.FRONTEND_URL)
  checks.trusted_frontend_origin = Boolean(origin) && (env.NODE_ENV !== 'production' || origin.startsWith('https://'))
  const smtp = getSmtpConfiguration(env)
  checks.smtp_configuration = Boolean(smtp && isMailbox(smtp.from))
  checks.jwt_secret = typeof env.JWT_SECRET === 'string' && env.JWT_SECRET.length >= 32
  // No URI echo/parsing diagnostics: it may contain database credentials.
  checks.database_configuration = typeof env.MONGODB_URI === 'string' && /^mongodb(?:\+srv)?:\/\/\S+$/.test(env.MONGODB_URI)
  checks.proxy_hops = env.TRUST_PROXY_HOPS === undefined || env.TRUST_PROXY_HOPS === '' || (
    typeof env.TRUST_PROXY_HOPS === 'string' && /^\d+$/.test(env.TRUST_PROXY_HOPS) && Number(env.TRUST_PROXY_HOPS) <= 10
  )
  checks.alert_opt_in = env.SAVED_SEARCH_ALERTS_ENABLED === undefined || ['true', 'false'].includes(env.SAVED_SEARCH_ALERTS_ENABLED)
  return {
    configurationValid: Object.values(checks).every(Boolean),
    launchApproved: false,
    alertsEnabled: env.SAVED_SEARCH_ALERTS_ENABLED === 'true',
    passed: Object.keys(checks).filter(key => checks[key]),
    failed: Object.keys(checks).filter(key => !checks[key]),
    externalChecks: [
      'existing_owner_account_and_login',
      'smtp_delivery_and_domain_authentication',
      'proxy_chain_and_shared_abuse_controls',
      'deployed_origins_artifacts_and_backup_pair',
      'alert_worker_timer_and_delivery_unknown_review',
      'explicit_push_and_deployment_approval',
    ],
  }
}
