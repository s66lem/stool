// Runs a task's hidden check inside a finished run's folder. The check goes in `.bench-check/` (copied in after the
// run, so the agent never saw it) and imports the fixture as `../src/...`.
import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'

// without NODE_TEST_CONTEXT: a node --test started from inside another test run reports to it and exits 0
export function cleanEnv() {
  const { NODE_TEST_CONTEXT, ...env } = process.env
  return env
}

export function runCheck(dir, checkFile, timeoutMs = 120_000) {
  const target = join(dir, '.bench-check', basename(checkFile))
  mkdirSync(join(dir, '.bench-check'), { recursive: true })
  copyFileSync(checkFile, target)
  // a relative, forward-slash path: node --test reads its arguments as globs, and a Windows path matches nothing
  const r = spawnSync(process.execPath, ['--test', `.bench-check/${basename(checkFile)}`], { cwd: dir, encoding: 'utf8', timeout: timeoutMs, env: cleanEnv() })
  return r.status === 0
}
