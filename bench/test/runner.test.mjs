import { test } from 'node:test'
import assert from 'node:assert/strict'

import { claudeArgs, overBudget, parseResult, planRuns, stoolLoaded } from '../lib/runner.mjs'

const tasks = [
  { id: 's1', size: 'small' },
  { id: 's2', size: 'small' },
  { id: 's3', size: 'small' },
  { id: 'L', size: 'long' },
]

test('full runs each small task twice and the long one once, per setup, off and on interleaved', () => {
  const runs = planRuns('full', tasks)
  assert.equal(runs.length, 3 * 2 * 2 + 2)
  assert.deepEqual(runs.slice(0, 2), [{ task: 's1', setup: 'off', rep: 1 }, { task: 's1', setup: 'on', rep: 1 }])
  assert.deepEqual(runs.filter(r => r.task === 'L'), [{ task: 'L', setup: 'off', rep: 1 }, { task: 'L', setup: 'on', rep: 1 }])
})

test('smoke runs the first small task once per setup', () => {
  assert.deepEqual(planRuns('smoke', tasks), [{ task: 's1', setup: 'off', rep: 1 }, { task: 's1', setup: 'on', rep: 1 }])
})

test('claudeArgs: a clean profile, stool only when on', () => {
  const o = { prompt: 'do it', model: 'sonnet', stoolDir: '/stool', debugFile: '/d.txt' }
  const off = claudeArgs('off', o)
  const on = claudeArgs('on', o)
  assert.deepEqual(off.slice(0, 4), ['-p', 'do it', '--model', 'sonnet'])
  assert.equal(off[off.indexOf('--setting-sources') + 1], '')
  for (const flag of ['--strict-mcp-config', '--dangerously-skip-permissions', '--output-format']) assert.ok(off.includes(flag), flag)
  assert.equal(off.includes('--plugin-dir'), false)
  assert.equal(on[on.indexOf('--plugin-dir') + 1], '/stool')
  assert.equal(on[on.indexOf('--debug-file') + 1], '/d.txt')
})

test('parseResult reads the session id and error flag, or null for anything else', () => {
  assert.deepEqual(parseResult('{"type":"result","is_error":false,"session_id":"abc"}'), { sessionId: 'abc', isError: false })
  assert.deepEqual(parseResult('noise\n{"type":"result","is_error":true,"session_id":"x"}\n'), { sessionId: 'x', isError: true })
  assert.equal(parseResult('Error: boom'), null)
  assert.equal(parseResult(''), null)
})

test('stoolLoaded spots the stool hooks module in a debug log', () => {
  assert.equal(stoolLoaded('2026-10-23T07:32:23.268Z [DEBUG] hooks module stool@inline loaded (worker, environment 1, tier user); events: turn.start'), true)
  assert.equal(stoolLoaded('2026-10-23T07:32:23.268Z [DEBUG] hooks module cc-plugin-diff@builtin loaded (native, environment 5)'), false)
})

test('overBudget', () => {
  assert.equal(overBudget(49, 2, 50), true)
  assert.equal(overBudget(40, 5, 50), false)
})
