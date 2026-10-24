import { test } from 'node:test'
import assert from 'node:assert/strict'

import { markdown } from '../lib/report.mjs'

const rows = [
  { task: 'A', setup: 'off', runs: 2, passes: 2, usd: 2.2, usdPerPass: 1.1 },
  { task: 'A', setup: 'on', runs: 2, passes: 1, usd: 1.0, usdPerPass: 1.0 },
  { task: 'B', setup: 'off', runs: 1, passes: 1, usd: 3, usdPerPass: 3 },
  { task: 'B', setup: 'on', runs: 1, passes: 0, usd: 2, usdPerPass: Infinity },
]
const v = { totalOff: 5.2 / 3, totalOn: 3, saving: 1 - 3 / (5.2 / 3), real: false, perTask: [] }
const meta = { date: '2026-10-24', mode: 'full', model: 'sonnet', stoolVersion: '2.11.0', claudeVersion: '2.1.303', rate: 0.075, budgetUsd: 50, spentUsd: 8.2, stoppedAtBudget: false }

test('the report has a header, one table row per task and setup, and the verdict', () => {
  const md = markdown(rows, v, meta)
  assert.match(md, /2026-10-24.*full.*sonnet.*stool 2\.11\.0.*Claude Code 2\.1\.303/)
  assert.match(md, /\| Task \| Setup \| Runs \| Passes \| \$ \| \$\/pass \| w%\/pass \|/)
  assert.match(md, /\| A \| off \| 2 \| 2 \| 2\.20 \| 1\.10 \| 0\.08 \|/)
  assert.match(md, /\| B \| on \| 1 \| 0 \| 2\.00 \| - \| - \|/)
  assert.match(md, /Saving per passed task: -73% \(within noise\)/)
  assert.doesNotMatch(md, /Stopped at budget/)
})

test('a run stopped by the budget says so', () => {
  assert.match(markdown(rows, { ...v, real: true }, { ...meta, stoppedAtBudget: true }), /Stopped at budget[^\n]*\$8\.20 of \$50/)
  assert.match(markdown(rows, { ...v, real: true }, meta), /\(real\)/)
})
