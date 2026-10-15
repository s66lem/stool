import { expect, mock, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

import { EXPIRE_MS, live } from './register'

tier('user')

const OPT = { options: { projectRoots: ['C:/Users/dev/work'], dispatchGuard: true, slotFile: 'C:/slots.json', dispatchOrders: '- Edit only the files this prompt assigns to you.', dispatchCapPattern: 'studio-open|studio|screen_capture', dispatchCapOrders: '- Open the app only when 3 GB RAM is free: wait up to 9 minutes for it.\n- Check the app window isn\'t minimized before each capture.', dispatchCheapAgents: ['worker', 'haiku-implementer'] } }

const NOW = 10 * 3600_000
const IN = 'C:/Users/dev/work/app'

// the engine beneath: a cwd, usage-pace's cap, a slot file in memory, and a spawn that hands out ids
function world(on: On, o: { cwd?: string; cap?: number; file?: string } = {}) {
  mock.clock(on, { now: NOW })
  on('tool.call', { tool: 'mcp__stool__agent_cap' } as never, () => ({ text: o.cap === undefined ? 'no tool' : `Agent cap ${o.cap} (on pace).`, result: '' }) as never)
  const w = { file: o.file as string | undefined, prompts: [] as string[], n: 0 }
  on('session.cwd', () => ({ value: o.cwd ?? IN }))
  on('fs.read', () => {
    if (w.file === undefined) throw new Error('ENOENT')
    return { value: w.file }
  })
  on('fs.write', (_$, e) => { w.file = e.text; return { value: undefined } })
  on('agent.spawn', (_$, e) => { w.prompts.push(e.prompt); return { model: 'claude-sonnet-5-5', agentId: 'a' + ++w.n } })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return w
}
// usage-pace's strip value, which dispatch-guard reads for the cap
const capIs = (_$: any, _cap: number) => {} // the cap comes from world()'s o.cap
const spawn = ($: any, over: object = {}) => $.agent.spawn({ prompt: 'Fix the bug in X.', ...over })

test('appends the standing orders once, keeping the prompt own cap', OPT, async ($, on) => {
  const w = world(on)
  await spawn($, { prompt: 'Do it. Cap: about 40 tool calls.' })
  expect(w.prompts[0]).toContain('STANDING ORDERS')
  expect(w.prompts[0]).toContain('cap stated above')
  expect(w.prompts[0]).not.toContain('about 100')
  await spawn($, { prompt: w.prompts[0] })
  expect(w.prompts[1].split('STANDING ORDERS').length).toBe(2)
  await spawn($)
  expect(w.prompts[2]).toContain('about 100')
  expect(w.prompts[2]).not.toContain('3 GB')
})

test('a cap-pattern dispatch needs a cap and gets the RAM wait', OPT, async ($, on) => {
  const w = world(on)
  const r = await spawn($, { prompt: 'Open the app with studio-open and screen_capture the map.' })
  expect(r.deny).toContain('tool-call cap')
  expect(w.prompts.length).toBe(0)
  await spawn($, { prompt: 'Use Studio; about 120 tool calls.' })
  expect(w.prompts[0]).toContain('wait up to 9 minutes')
  expect(w.prompts[0]).toContain('minimized')
})

test('Sonnet/Opus are held to agent_cap across sessions; Haiku is exempt', OPT, async ($, on) => {
  const w = world(on, { cap: 2 })
  await capIs($, 2)
  await spawn($)
  await spawn($)
  expect((await spawn($)).deny).toContain('agent_cap is 2')
  expect(JSON.parse(w.file!).length).toBe(2)
  await spawn($, { model: 'haiku' })
  await spawn($, { subagentType: 'worker' })
  expect(w.prompts.length).toBe(4)
  expect(JSON.parse(w.file!).length).toBe(2)
})

test('a finished agent frees its slot; no cap reading skips the check', OPT, async ($, on) => {
  const w = world(on, { cap: 1 })
  await capIs($, 1)
  await spawn($)
  expect((await spawn($)).deny).toBeDefined()
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId: 'a1' })
  expect(JSON.parse(w.file!).length).toBe(0)
  expect((await spawn($)).deny).toBeUndefined()
})

test('stale slots expire and out-of-scope sessions are left alone', OPT, async ($, on) => {
  const old = JSON.stringify([{ id: 'x', at: 0 }])
  const w = world(on, { cap: 1, file: old })
  await capIs($, 1)
  const now = NOW
  expect(live([{ id: 'x', at: 0 }, { id: 'y', at: now }], now).length).toBe(1)
  expect(live([{ id: 'x', at: now - EXPIRE_MS + 1000 }], now).length).toBe(1)
  expect((await spawn($)).deny).toBeUndefined() // the stale slot at 1970 does not count
  expect(w.prompts[0]).toContain('STANDING ORDERS')
})

test('outside the configured roots nothing is touched', OPT, async ($, on) => {
  const w = world(on, { cwd: 'C:/other/repo', cap: 0 })
  expect((await spawn($, { prompt: 'Studio please' })).deny).toBeUndefined()
  expect(w.prompts[0]).toBe('Studio please')
})

test('no cap reading means no cap check', OPT, async ($, on) => {
  world(on)
  for (let i = 0; i < 4; i++) expect((await spawn($)).deny).toBeUndefined()
})

test('a SendMessage resume takes a slot again; a cheap one does not', OPT, async ($, on) => {
  const w = world(on, { cap: 4 })
  on('tool.call', { tool: 'SendMessage' } as never, (_$, e: any) => ({ result: { success: true, resumedAgentId: e.to } }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  const done = (id: string) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId: id })
  const resume = (to: string) => $.tool.call({ tool: 'SendMessage', to, message: 'more' } as never)
  await spawn($)
  await spawn($, { model: 'haiku' })
  await done('a1')
  await done('a2')
  expect(JSON.parse(w.file!).length).toBe(0)
  await resume('a1')
  await resume('a2')
  expect(JSON.parse(w.file!).map((s: { id: string }) => s.id)).toEqual(['a1'])
  await resume('a1') // a message to a running agent adds no second slot
  expect(JSON.parse(w.file!).length).toBe(1)
  await done('a1')
  expect(JSON.parse(w.file!).length).toBe(0)
})
