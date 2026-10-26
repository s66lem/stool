import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compare, ratio } from '../lib/trial.mjs'

test('ratio is total $ over total commits', () => {
  assert.equal(ratio([{ usd: 4, commits: 1 }, { usd: 2, commits: 1 }]).perCommit, 3)
  assert.ok(Number.isNaN(ratio([{ usd: 4, commits: 0 }]).perCommit))
})

test('compare: a clear 45% saving has an interval above zero, and the same seed repeats', () => {
  const rows = []
  for (let i = 0; i < 30; i++) rows.push({ arm: 'on', usd: 5 + (i % 3), commits: 2 }, { arm: 'off', usd: 10 + (i % 3), commits: 2 })
  const a = compare(rows)
  assert.ok(Math.abs(a.saving - (1 - 6 / 11)) < 0.05)
  assert.ok(a.ci[0] > 0)
  assert.deepEqual(compare(rows).ci, a.ci)
})

test('compare: no difference gives an interval around zero; too few sessions give no interval', () => {
  const rows = []
  for (let i = 0; i < 30; i++) rows.push({ arm: 'on', usd: 5 + (i % 4), commits: 2 }, { arm: 'off', usd: 5 + ((i + 1) % 4), commits: 2 })
  const a = compare(rows)
  assert.ok(a.ci[0] < 0 && a.ci[1] > 0)
  assert.equal(compare([{ arm: 'on', usd: 1, commits: 1 }, { arm: 'off', usd: 2, commits: 1 }]).ci, undefined)
})
