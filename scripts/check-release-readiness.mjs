import { checkReleaseConfiguration } from '../src/utils/releaseReadiness.js'

// Configuration is inherited from the invoking shell/secret manager. Never load
// local .env files implicitly or contact production services as a readiness probe.
const result = checkReleaseConfiguration()
console.log(JSON.stringify(result, null, 2))
process.exitCode = result.configurationValid ? 0 : 1
