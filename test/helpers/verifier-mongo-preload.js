// Test-only singleton stubs: the real verifier CLI never opens a database or HTTP listener.
import { appendFileSync } from 'node:fs'
import mongoose from 'mongoose'

const scenario = process.env.VERIFIER_TEST_SCENARIO
const trace = process.env.VERIFIER_TEST_TRACE
if (!scenario || !trace) throw new Error('Verifier preload requires a scenario and trace')
const record = event => appendFileSync(trace, `${event}\n`, { mode: 0o600 })
mongoose.connect = async () => {
  record('connect')
  mongoose.connection.readyState = 1
  mongoose.connection.db = {
    listCollections: () => ({
      toArray: async () => {
        record('discover')
        if (scenario === 'discovery-failure') throw new Error('Mock discovery failure')
        return scenario.startsWith('nonempty') ? [{ name: 'retained' }] : []
      },
    }),
  }
  return mongoose
}
mongoose.disconnect = async () => {
  record('disconnect')
  if (scenario === 'nonempty-disconnect-failure') throw new Error('Mock disconnect failure')
  mongoose.connection.readyState = 0
}
mongoose.connection.dropDatabase = async () => {
  record('drop')
  if (scenario === 'drop-failure') throw new Error('Mock drop failure')
}
const { default: User } = await import('../../src/models/User.js')
User.create = async () => {
  record('seed')
  throw new Error('Mock seed failure before HTTP startup')
}
