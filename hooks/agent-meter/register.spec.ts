import { expect, mock, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

import { capOf, row } from './register'

tier('user')

const OPT = { options: { projectRoots: ['C:/Users/dev/work'], agentLedger: 'C:/ledger.tsv' } }

const IN = 'C:/Users/dev/work/app'

function world(on: On, cwd = IN) {
  mock.clock(on, { now: 10 * 3600_000 })
  const w = { file: undefined as string | undefined, toasts: [] as string[], strip: undefined as unknown, n: 0 }
  on('session.cwd', () => ({ value: cwd }))
  on('fs.read', () => {
    if (w.file === undefined) throw new Error('ENOENT')
    return { value: w.file }
  })
  on('fs.write', (_$, e) => { w.file = e.text; return { value: undefined } })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a' + ++w.n }))
  on('tool.call', () => ({ result: '' }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('state.set', (_$, e: any) => { w.strip = e.value; return { value: undefined } as never })
  on('ui.toast', (_$, e: any) => { w.toasts.push(e.text); return { value: undefined } as never })
  return w
}
const done = ($: any, agentId: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 61_000, isAborted: false, turnId: 't', reason: 'answer', agentId, usage: { model: 'm', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 1 } })

test('capOf takes the first stated cap', () => {
  expect(capOf('Do it. about 120 tool calls: stop. Tool-call cap: about 100 tool calls')).toBe(120)
  expect(capOf('no cap here')).toBe(undefined)
})

test('row is one tab-separated line', () => {
  const m = { type: 'implementer', model: 'x', description: 'a\tb\nc', cap: 5, calls: 3, warned: false }
  expect(row(m, { time: 'T', cwd: 'C', tokens: 9, ms: 61_000 })).toBe('T\tC\timplementer\tx\ta b c\t3\t9\t61\t5')
})

test('an agent over its cap toasts once; its end appends a ledger line', OPT, async ($, on) => {
  const w = world(on)
  await $.agent.spawn({ prompt: 'Fix X in about 2 tool calls.', description: 'fix x', subagentType: 'implementer' })
  for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'Read', input: {}, agentId: 'a1' } as never)
  expect(w.toasts.length).toBe(1)
  expect(w.strip).toEqual({ agents: [{ id: 'a1', desc: 'fix x', calls: 4, cap: 2 }] })
  await done($, 'a1')
  const lines = w.file!.split('\n')
  expect(lines[0]).toContain('time\tcwd')
  expect(lines[1]).toContain('\timplementer\tclaude-sonnet-5-5\tfix x\t4\t116\t61\t2')
})

test('outside the configured roots nothing is recorded', OPT, async ($, on) => {
  const w = world(on, 'C:/other')
  await $.agent.spawn({ prompt: 'x', description: 'd', subagentType: 'implementer' })
  await done($, 'a1')
  expect(w.file).toBe(undefined)
})
