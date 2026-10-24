import { test } from 'node:test'
import assert from 'node:assert/strict'

import { score, verdict } from '../lib/score.mjs'

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
const runs = (task, setup, usds, passes = usds.map(() => true)) => usds.map((usd, i) => ({ task, setup, usd, pass: passes[i] }))
const row = (rows, task, setup) => rows.find(r => r.task === task && r.setup === setup)

test('a failed run still counts its cost against the passes', () => {
  const r = row(score(runs('A', 'on', [0.6, 0.5], [true, false])), 'A', 'on')
  assert.equal(r.runs, 2)
  assert.equal(r.passes, 1)
  near(r.usd, 1.1)
  near(r.usdPerPass, 1.1)
})

test('no passes means an infinite cost per pass', () => {
  assert.equal(row(score(runs('A', 'off', [1], [false])), 'A', 'off').usdPerPass, Infinity)
})

test('invalid runs are left out', () => {
  const r = row(score([...runs('A', 'off', [1]), { task: 'A', setup: 'off', usd: 9, pass: true, invalid: 'stool hooks in off run' }]), 'A', 'off')
  assert.equal(r.runs, 1)
  near(r.usd, 1)
})

test('a saving beyond the off spread on every task is real', () => {
  const all = [...runs('A', 'off', [1.0, 1.2]), ...runs('A', 'on', [0.5, 0.5]), ...runs('B', 'off', [2.0, 2.1]), ...runs('B', 'on', [1.0, 1.1])]
  const v = verdict(score(all), all)
  near(v.totalOff, 6.3 / 4)
  near(v.totalOn, 3.1 / 4)
  near(v.saving, 1 - 3.1 / 6.3)
  assert.equal(v.real, true)
  assert.equal(v.perTask.length, 2)
})

test('a saving on only half the tasks is within noise', () => {
  const all = [...runs('A', 'off', [1.0, 1.2]), ...runs('A', 'on', [0.5, 0.5]), ...runs('B', 'off', [2.0, 2.1]), ...runs('B', 'on', [2.0, 2.2])]
  assert.equal(verdict(score(all), all).real, false)
})
