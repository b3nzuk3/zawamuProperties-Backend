import test from 'node:test'
import assert from 'node:assert/strict'
import { checkReleaseConfiguration } from '../src/utils/releaseReadiness.js'

const configured = {
  NODE_ENV: 'production',
  ADMIN_EMAILS: 'zawamuproperty@gmail.com',
  CONTACT_NOTIFICATION_EMAIL: 'zawamuproperty@gmail.com',
  FRONTEND_URL: 'https://properties.example.test',
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_SECURE: 'false',
  SMTP_FROM: 'notifications@example.test', SMTP_USER: 'fixture-user', SMTP_PASSWORD: 'fixture-secret',
  JWT_SECRET: 'fixture-only-secret-with-at-least-thirty-two-characters',
  MONGODB_URI: 'mongodb://127.0.0.1/disposable_fixture',
  TRUST_PROXY_HOPS: '1', SAVED_SEARCH_ALERTS_ENABLED: 'false',
}

test('release configuration passes only local configuration checks, never provider/deployment proof', () => {
  const result = checkReleaseConfiguration(configured)
  assert.equal(result.configurationValid, true)
  assert.equal(result.launchApproved, false)
  assert.equal(result.alertsEnabled, false)
  assert.ok(result.externalChecks.includes('existing_owner_account_and_login'))
  assert.ok(result.externalChecks.includes('smtp_delivery_and_domain_authentication'))
  assert.ok(result.externalChecks.includes('proxy_chain_and_shared_abuse_controls'))
})

test('readiness reports safe keys, never supplied secrets or database URL', () => {
  const result = checkReleaseConfiguration({ ...configured, SMTP_PORT: 'invalid', JWT_SECRET: 'secret' })
  assert.equal(result.configurationValid, false)
  assert.ok(result.failed.includes('smtp_configuration'))
  assert.ok(result.failed.includes('jwt_secret'))
  const serialized = JSON.stringify(result)
  for (const value of [configured.JWT_SECRET, configured.SMTP_PASSWORD, configured.MONGODB_URI]) {
    assert.equal(serialized.includes(value), false)
  }
})

test('readiness requires the approved owner and recipient and rejects production loopback origins', () => {
  const result = checkReleaseConfiguration({ ...configured, ADMIN_EMAILS: '', CONTACT_NOTIFICATION_EMAIL: 'other@example.test', FRONTEND_URL: 'http://localhost:5173' })
  for (const key of ['approved_owner_allowlist', 'approved_enquiry_recipient', 'trusted_frontend_origin']) {
    assert.ok(result.failed.includes(key))
  }
})

test('strict proxy, boolean opt-in and SMTP sender validation fail closed', () => {
  const result = checkReleaseConfiguration({ ...configured, TRUST_PROXY_HOPS: '1junk', SAVED_SEARCH_ALERTS_ENABLED: 'yes', SMTP_FROM: 'x\r\nBcc: victim@example.test' })
  for (const key of ['proxy_hops', 'alert_opt_in', 'smtp_configuration']) assert.ok(result.failed.includes(key))
})
