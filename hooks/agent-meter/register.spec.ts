import { expect, mock, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

import { capOf, row } from './register'
import { HEADER_OLD, dollars, fmtTokens, fmtW, parse, rate, since, sum, withHeader } from './ledger'

tier('user')

const OPT = { options: { projectRoots: ['C:/Users/dev/work'], agentLedger: 'C:/ledger.tsv' } }

const IN = 'C:/Users/dev/work/app'

function world(on: On, cwd = IN) {
  mock.clock(on, { now: 10 * 3600_000 })
  const w = { file: undefined as string | undefined, toasts: [] as string[], strip: undefined as unknown, n: 0, prompt: '', toolResult: '' as unknown, pct: 10, store: {} as Record<string, unknown> }
  on('session.cwd', () => ({ value: cwd }))
  on('fs.read', () => {
    if (w.file === undefined) throw new Error('ENOENT')
    return { value: w.file }
  })
  on('fs.write', (_$, e) => { w.file = e.text; return { value: undefined } })
  on('agent.spawn', (_$, e) => { w.prompt = e.prompt; return { model: 'claude-sonnet-5-5', agentId: 'a' + ++w.n } })
  on('tool.call', () => ({ result: w.toolResult }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('state.set', (_$, e: any) => { w.strip = e.value; return { value: undefined } as never })
  on('session.id', () => ({ value: 's1' }) as never)
  on('env.get', () => ({ value: 'C:/Users/dev' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1, percent: 0 }, rateLimits: [{ kind: 'seven_day', percentUsed: w.pct, resetsAt: '1970-01-08T00:00:00Z' }] } }) as never)
  on('store.get', (_$, e: any) => ({ value: w.store[e.key] }) as never)
  on('store.set', (_$, e: any) => { w.store[e.key] = e.value; return { value: undefined } as never })
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

const MAIN = { options: { ...OPT.options, ledgerMainTurns: true } }
const mainTurn = ($: any) =>
  $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId: 't', reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } })

test('ledger lines carry the token counts and session; the old header is upgraded; main turns when asked', MAIN, async ($, on) => {
  const w = world(on)
  w.file = `${HEADER_OLD}\nT0\tC\timplementer\tm\td\t1\t9\t1\t5\n`
  await $.agent.spawn({ prompt: 'x', description: 'd', subagentType: 'implementer' })
  await done($, 'a1')
  const [head, old, line] = w.file!.split('\n')
  expect(head.endsWith('\tagent\tinput\toutput\tcache_read\tcache_write\tsession')).toBe(true)
  expect(old).toBe('T0\tC\timplementer\tm\td\t1\t9\t1\t5')
  expect(line.endsWith('\ta1\t10\t5\t100\t1\ts1')).toBe(true)
  await mainTurn($)
  const main = w.file!.split('\n')[3]
  expect(main).toContain('\tmain\tclaude-opus-5-5\t')
  expect(main.endsWith('\t\t1\t2\t3\t4\ts1')).toBe(true)
})

test('main turns are not logged unless ledgerMainTurns is on', OPT, async ($, on) => {
  const w = world(on)
  await mainTurn($)
  expect(w.file).toBe(undefined)
})

test('rows are priced at list prices; the rate is the meter climb over the dollars since the anchor', () => {
  const rows = parse(
    `${withHeader('')}1970-01-01T09:30:00.000Z\tC\tmain\tclaude-opus-5-5\t\t0\t0\t0\t\t\t1000000\t0\t0\t0\ts1\n` +
      `1970-01-01T09:31:00.000Z\tC\timplementer\tclaude-sonnet-5-5\td\t1\t0\t1\t\ta1\t0\t100000\t0\t0\ts1\n`,
  )
  expect(dollars(rows[0])).toBe(4) // opus $4 per million input, 1M
  expect(dollars(rows[1])).toBe(1) // sonnet $10 per million output, 100k
  const write = { ...rows[1], output: 0, cacheWrite: 1_000_000, cacheRead: 1_000_000 }
  expect(Math.abs(dollars(write, 1.4) - (2 * 1.4 + 0.2)) < 1e-9).toBe(true) // write at 1.4x input, read at $0.20
  expect(dollars({ ...write, model: 'claude-fable-5-1', cacheWrite: 0 })).toBe(0.25)
  const r = rate(rows, { at: 0, pct: 10 }, 15, 1e12)
  expect(r.usd).toBe(5)
  expect(r.perUsd).toBe(1)
  expect(r.hasLead).toBe(true)
  expect(sum(rows, x => x.agent === 'a1').agents.runs).toBe(1)
  expect(since('2h', 10 * 3600_000)).toBe(8 * 3600_000)
  expect(fmtW(0.4)).toBe('0.4w%')
  expect(fmtW(0.04)).toBe('0.04w%')
  expect(fmtW(12.3)).toBe('12w%')
  expect(fmtTokens(150_000)).toBe('150k')
})

test('usage_since sums the ledger and prices it at the calibrated rate', OPT, async ($, on) => {
  const w = world(on)
  w.pct = 15
  w.store['usage-anchor:1970-01-08T00:00:00Z'] = { at: 9 * 3600_000, pct: 10 }
  const rowAt = (type: string, agent: string, input: number) => `1970-01-01T09:30:00.000Z\tC\t${type}\tclaude-sonnet-5-5\td\t1\t${input}\t1\t\t${agent}\t${input}\t0\t0\t0\ts1`
  w.file = `${HEADER_OLD}\n${rowAt('main', '', 1_000_000)}\n${rowAt('implementer', 'a1', 1_000_000)}\n`
  const r = await $.tool.call({ tool: 'mcp__stool__usage_since', input: {} } as never)
  const text = String((r as { result?: unknown }).result)
  // two sonnet rows of 1M input at $2 each: $4 for 5 points
  expect(text.split('\n')[0]).toBe('5.0w% (2.0m tokens)')
  expect(text).toContain('agents: 1 runs, 1.0m tokens, 2.5w%')
  expect(text).toContain('1 w% is about $0.8')
  expect(text).toContain('lead: 1 turns')
})

test('no stated cap: the default is told to the agent, noted past it, and tools stop a quarter beyond', { options: { ...OPT.options, agentCallCap: 4 } }, async ($, on) => {
  const w = world(on)
  await $.agent.spawn({ prompt: 'Fix X.', description: 'fix x', subagentType: 'implementer' })
  expect(w.prompt).toContain('Tool-call cap: about 4')
  const call = () => $.tool.call({ tool: 'Read', input: {}, agentId: 'a1' } as never) as Promise<{ deny?: string; context?: string[] }>
  for (let i = 0; i < 4; i++) expect((await call()).context).toBeUndefined()
  const note = String((await call()).context)
  expect(note).toContain('past your 4 tool-call cap')
  expect(note).toContain('relay/a1.md')
  expect(note).toContain('RELAY:')
  for (let i = 0; i < 9; i++) await call() // calls 6..14 = hard limit 14
  expect((await call()).deny).toContain('limit reached')
})

test('an agent result that relays tells the lead to continue with a fresh agent reading the handoff', OPT, async ($, on) => {
  const w = world(on)
  w.toolResult = 'Did half of it.\nRELAY: C:/Users/dev/.claude/stool/relay/a7.md'
  const r = (await $.tool.call({ tool: 'Agent', input: {} } as never)) as { context?: string[] }
  expect(String(r.context)).toContain('fresh agent')
  expect(String(r.context)).toContain('C:/Users/dev/.claude/stool/relay/a7.md')
  w.toolResult = 'All done.'
  expect(((await $.tool.call({ tool: 'Agent', input: {} } as never)) as { context?: string[] }).context).toBeUndefined()
})

test('the governor shrinks the default cap while the usage strip says squeeze', OPT, async ($, on) => {
  const w = world(on)
  on('state.get', () => ({ value: { value: { squeeze: 2 } } }) as never)
  await $.agent.spawn({ prompt: 'Fix X.', description: 'fix x', subagentType: 'implementer' })
  expect(w.prompt).toContain('Tool-call cap: about 40')
})
