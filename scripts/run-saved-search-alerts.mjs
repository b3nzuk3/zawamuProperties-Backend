#!/usr/bin/env node
import mongoose from 'mongoose'
import { pathToFileURL } from 'node:url'
import SavedSearch from '../src/models/SavedSearch.js'
import AlertDelivery from '../src/models/AlertDelivery.js'
import AlertLease from '../src/models/AlertLease.js'
import { runSavedSearchAlerts } from '../src/services/savedSearchAlerts.js'
import { getTrustedFrontendOrigin } from '../src/utils/contactRules.js'
import { getSmtpConfiguration } from '../src/utils/smtpTransport.js'

const USAGE = `Usage: node scripts/run-saved-search-alerts.mjs [--execute] [--help]

Runs one bounded saved-search alert worker pass. Default is read-only dry-run.
--execute  Allow sends only when SAVED_SEARCH_ALERTS_ENABLED=true and SMTP/origin are valid.
--help     Print this help without connecting to MongoDB.

Requires an explicitly inherited MONGODB_URI. This command never loads .env and
never installs a recurring timer.`

function parseArgs(args) {
  const options = { execute: false, help: false }
  for (const arg of args) {
    if (arg === '--execute' && !options.execute) options.execute = true
    else if (arg === '--help' && !options.help) options.help = true
    else throw new TypeError('invalid_arguments')
  }
  return options
}

function mailIsConfigured(env) {
  if (env.SAVED_SEARCH_ALERTS_ENABLED !== 'true') return false
  const smtp = getSmtpConfiguration(env)
  const sender = smtp?.from || (typeof env.EMAIL_FROM === 'string' ? env.EMAIL_FROM.trim() : '')
  return Boolean(smtp && sender && getTrustedFrontendOrigin(env.FRONTEND_URL ?? ''))
}

export async function main(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  const {
    mongooseClient = mongoose,
    models = { SavedSearch, AlertDelivery, AlertLease },
    runWorker = runSavedSearchAlerts,
    stdout = process.stdout,
    stderr = process.stderr,
  } = dependencies
  let options
  try {
    options = parseArgs(args)
  } catch {
    stderr.write('Invalid arguments. Use --help for usage.\n')
    return 2
  }
  if (options.help) {
    stdout.write(USAGE + '\n')
    return 0
  }
  const uri = typeof env.MONGODB_URI === 'string' ? env.MONGODB_URI.trim() : ''
  if (!uri) {
    stderr.write('Saved-search alert worker requires inherited MONGODB_URI.\n')
    return 2
  }

  let stage = 'database_connect'
  let connectionAttempted = false
  let failure = null
  try {
    // Dry-run never creates collections or builds indexes implicitly.
    mongooseClient.set('autoIndex', false)
    mongooseClient.set('autoCreate', false)
    connectionAttempted = true
    await mongooseClient.connect(uri, { autoCreate: false, autoIndex: false })
    if (options.execute && mailIsConfigured(env)) {
      stage = 'required_indexes'
      await Promise.all([
        models.SavedSearch.createIndexes(),
        models.AlertDelivery.createIndexes(),
        models.AlertLease.createIndexes(),
      ])
    }
    stage = 'worker'
    const summary = await runWorker({ execute: options.execute, env })
    stdout.write(`${JSON.stringify(summary)}\n`)
  } catch {
    failure = stage
  } finally {
    if (connectionAttempted) {
      try {
        await mongooseClient.disconnect()
      } catch {
        failure ??= 'database_disconnect'
      }
    }
  }
  if (failure) {
    stderr.write(`Saved-search alert worker failed (${failure}).\n`)
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code })
}
