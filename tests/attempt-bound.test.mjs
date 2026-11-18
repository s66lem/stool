// attemptBound retries only while $.tool.register / $.command.register say the session is not bound yet.
// A throw from a test's on('tool.register') is the test hook failing, not that engine error, so this runs the helper directly.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { attemptBound } from '../hooks/attempt-bound.ts'

const unbound = () => new Error('stool: $.tool.register is not available in this mode: no session is bound in this process; catch it and carry on')

test('retries while the session is not bound, then returns the registration', async () => {
  const slept = []
  let calls = 0
  const result = await attemptBound(async () => {
    calls += 1
    if (calls < 3) throw unbound()
    return { tool: 'mcp__stool__restart_session' }
  }, async (ms) => { slept.push(ms) })
  assert.equal(calls, 3)
  assert.deepEqual(slept, [0, 0])
  assert.equal(result.tool, 'mcp__stool__restart_session')
})

test('a different refusal is not retried', async () => {
  let calls = 0
  await assert.rejects(attemptBound(async () => {
    calls += 1
    throw new Error('refused: reserved name')
  }, async () => { throw new Error('should not sleep') }), /reserved name/)
  assert.equal(calls, 1)
})

test('gives up once the waits are spent and the session is still not bound', async () => {
  let calls = 0
  const slept = []
  await assert.rejects(attemptBound(async () => {
    calls += 1
    throw unbound()
  }, async (ms) => { slept.push(ms) }), /no session is bound/)
  assert.equal(calls, slept.length + 1)
  assert.deepEqual(slept, [0, 0, 0, 0, 20, 50, 100, 200, 400, 800, 1600])
})
