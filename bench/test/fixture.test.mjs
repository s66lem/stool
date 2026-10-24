import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { cleanEnv, runCheck } from '../lib/check.mjs'

const BENCH = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE = join(BENCH, 'fixture')
const tasks = JSON.parse(readFileSync(join(BENCH, 'tasks.json'), 'utf8'))

function copy(withSolution) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-fixture-'))
  cpSync(FIXTURE, dir, { recursive: true })
  if (withSolution) cpSync(join(BENCH, 'solutions', withSolution), dir, { recursive: true })
  return dir
}

test('tasks.json has 3 small tasks and 1 long one, unique ids, checks and solutions present', () => {
  assert.equal(tasks.filter(t => t.size === 'small').length, 3)
  assert.equal(tasks.filter(t => t.size === 'long').length, 1)
  assert.equal(new Set(tasks.map(t => t.id)).size, tasks.length)
  for (const t of tasks) {
    assert.ok(t.prompt.length > 40, t.id)
    assert.ok(existsSync(join(BENCH, 'checks', t.check)), t.check)
    assert.ok(existsSync(join(BENCH, 'solutions', t.id)), t.id)
  }
})

test('the pristine fixture passes its own tests', () => {
  const r = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { cwd: FIXTURE, encoding: 'utf8', env: cleanEnv() })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

for (const t of tasks) {
  test(`${t.id}: the check fails on the pristine fixture and passes on the solution`, () => {
    const pristine = copy()
    const solved = copy(t.id)
    try {
      assert.equal(runCheck(pristine, join(BENCH, 'checks', t.check)), false)
      assert.equal(runCheck(solved, join(BENCH, 'checks', t.check)), true)
      const own = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { cwd: solved, encoding: 'utf8', env: cleanEnv() })
      assert.equal(own.status, 0, `solution breaks the fixture's own tests:\n${own.stdout}`)
    } finally {
      rmSync(pristine, { recursive: true, force: true })
      rmSync(solved, { recursive: true, force: true })
    }
  })
}
