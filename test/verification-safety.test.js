import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const script = fileURLToPath(new URL('../scripts/verify-phase-a.mjs', import.meta.url))
const run = (extraEnv = {}, args = [], nodeArgs = []) => {
  const env = { ...process.env, MONGODB_URI: 'mongodb://must-not-be-used.invalid/production', ...extraEnv }
  delete env.TEST_MONGODB_URI
  if (Object.hasOwn(extraEnv, 'TEST_MONGODB_URI')) env.TEST_MONGODB_URI = extraEnv.TEST_MONGODB_URI
  return spawnSync(process.execPath, [...nodeArgs, script, ...args], { env, encoding: 'utf8', timeout: 10000 })
}

for (const [scenario, expectedEvents, error] of [
  ['discovery-failure', ['connect', 'discover', 'disconnect'], /Mock discovery failure/],
  ['nonempty', ['connect', 'discover', 'disconnect'], /Disposable database is not empty/],
  ['nonempty-disconnect-failure', ['connect', 'discover', 'disconnect'], /Mock disconnect failure/],
  ['seed-failure', ['connect', 'discover', 'seed', 'drop', 'disconnect'], /Mock seed failure/],
  ['drop-failure', ['connect', 'discover', 'seed', 'drop', 'disconnect'], /Mock drop failure/],
]) {
  test(`mocked verifier cleanup: ${scenario}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'zawamu-verifier-cleanup-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const trace = join(directory, 'events')
    const preload = fileURLToPath(new URL('./helpers/verifier-mongo-preload.js', import.meta.url))
    const result = run({
      TEST_MONGODB_URI: 'mongodb://127.0.0.1:0/zawamu_phase_a_mock',
      VERIFIER_TEST_SCENARIO: scenario,
      VERIFIER_TEST_TRACE: trace,
    }, [], ['--import', preload])
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(result.stderr, error)
    assert.deepEqual((await readFile(trace, 'utf8')).trim().split('\n'), expectedEvents)
  })
}

test('real acceptance never falls back to a production MONGODB_URI', () => {
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /TEST_MONGODB_URI is required/)
  assert.doesNotMatch(result.stderr, /must-not-be-used\.invalid|ENOTFOUND|MongoServerSelectionError/)
})

for (const uri of [
  'mongodb://example.com/zawamu_phase_a_test',
  'mongodb://localhost/zawamu_phase_a_test',
  'mongodb://127.0.0.1/production',
  'mongodb://127.0.0.1/zawamu_phase_a_test?replicaSet=anything',
  'mongodb://user:password@127.0.0.1/zawamu_phase_a_test',
  'mongodb+srv://127.0.0.1/zawamu_phase_a_test',
]) {
  test('real acceptance rejects a non-disposable target before importing the app: ' + uri.replace('user:password@', '<credentials>@'), () => {
    const result = run({ TEST_MONGODB_URI: uri })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /credential-free loopback MongoDB URI/)
    assert.doesNotMatch(result.stderr, /MongoServerSelectionError|ENOTFOUND/)
  })
}

test('browser-serving acceptance refuses to put fixture credentials in the repository', () => {
  const result = run({ TEST_MONGODB_URI: 'mongodb://127.0.0.1/zawamu_phase_a_safety', PHASE_A_FIXTURE_FILE: script + '.credentials' }, ['--serve'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /absolute path outside the repository/)
})

test('a ..filename is still inside the repository, not a parent directory', () => {
  const destination = fileURLToPath(new URL('../..phase-a-credentials.json', import.meta.url))
  const result = run({ TEST_MONGODB_URI: 'mongodb://127.0.0.1:0/zawamu_phase_a_safety', PHASE_A_FIXTURE_FILE: destination }, ['--serve'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /absolute path outside the repository/)
})

test('an outside symlink to the repository cannot receive fixture credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'zawamu-verifier-safety-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const alias = join(directory, 'repository')
  await symlink(fileURLToPath(new URL('../', import.meta.url)), alias, 'dir')
  const result = run({ TEST_MONGODB_URI: 'mongodb://127.0.0.1:0/zawamu_phase_a_safety', PHASE_A_FIXTURE_FILE: join(alias, 'credentials.json') }, ['--serve'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /absolute path outside the repository/)
})
