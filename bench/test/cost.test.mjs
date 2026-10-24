import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { priceUsage, sessionCost } from '../lib/cost.mjs'

const PROJECTS = fileURLToPath(new URL('./fixtures/projects', import.meta.url))
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)

test('priceUsage prices input, output, cache reads and both cache-write kinds', () => {
  near(priceUsage('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 0, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 5e5 } }), 2 + 0.2 + 0.5 * 2 * 1.25 + 0.5 * 2 * 2)
  near(priceUsage('claude-opus-5-5', { output_tokens: 1e6 }), 20)
  near(priceUsage('gpt-x', { input_tokens: 1e6 }), 0)
})

test('sessionCost counts each message once across lead and subagent files', () => {
  const c = sessionCost(PROJECTS, 's1')
  assert.equal(c.msgs, 3)
  assert.equal(c.agents, 1)
  near(c.usd, 0.01 + 0.01 + 0.0016)
  assert.equal(c.leadMaxCtx, 50000)
  assert.equal(c.agentMaxCtx, 101000)
})

test('sessionCost of an unknown session is zero', () => {
  assert.deepEqual(sessionCost(PROJECTS, 'nope'), { usd: 0, msgs: 0, leadMaxCtx: 0, agentMaxCtx: 0, agents: 0 })
})
