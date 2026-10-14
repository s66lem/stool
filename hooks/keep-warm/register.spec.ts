import { expect, mock, test, tier } from 'claude-code/testing'
import type { ModelForkResult, On, SessionStartInput, TurnCompleteInput } from 'claude-code'

import { inScope } from '../config'
import { MAX_PINGS } from './register'

tier('user')

const OPT = { options: { projectRoots: ['C:/Users/dev/work'] } }

const MIN = 60_000
const START = 10 * 60 * MIN
const session: SessionStartInput = { surface: null, isInteractive: false, cwd: 'C:/Users/dev/work/app' }
let turns = 0
const turn = (): TurnCompleteInput => ({
  answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't' + ++turns, reason: 'answer',
  usage: { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 200000, cache_creation_input_tokens: 500, model: 'claude-opus-5-5' },
})

// why warming stopped, as /keepwarm reports it (the strip above the progress bars shows only the counts)
const why = async ($: { command: { run: (e: never) => Promise<unknown> } }) =>
  ((await $.command.run({ command: 'keepwarm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)) as { text: string }).text

// the engine beneath the mod: a context size, rate limits, and a fork that answers from a script
function world(on: On, opts: { tokens?: number; weekly?: number; forks?: Array<{ read: number; write: number }> } = {}) {
  const forks: number[] = []
  const status: Array<string | undefined> = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: START,
      context: { window: 1000000, tokens: opts.tokens ?? 200000 },
      rateLimits: opts.weekly === undefined ? [] : [{ kind: 'seven_day', percentUsed: opts.weekly, resetsAt: '2026-10-15T10:00:00Z' }],
    },
  }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: e.name } }))
  on('prompt.compose', () => ({ sections: [] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.status', ($, e) => { status.push(e.text); return { value: undefined } })
  on('model.fork', () => {
    forks.push(forks.length)
    const a = opts.forks?.shift() ?? { read: 200000, write: 0 }
    const value: ModelForkResult = { isAnswered: true, text: 'warm', usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: a.read, cache_creation_input_tokens: a.write } }
    return { value }
  })
  return { forks, status }
}

test('an idle big session is pinged every 50 minutes, at most MAX_PINGS times', OPT, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  const w = world(on)
  await $.session.start(session)
  await $.turn.complete(turn())
  await clock.advance(49 * MIN)
  expect(w.forks.length).toBe(0)
  await clock.advance(2 * MIN)
  expect(w.forks.length).toBe(1)
  for (let i = 0; i < 30; i++) await clock.advance(50 * MIN)
  expect(w.forks.length).toBe(MAX_PINGS)
  expect(await why($)).toContain(`${MAX_PINGS} pings sent`)
})

test('a turn in the idle stretch restarts the wait and the count', OPT, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  const w = world(on)
  await $.session.start(session)
  await $.turn.complete(turn())
  await clock.advance(40 * MIN)
  await $.turn.complete(turn())
  await clock.advance(40 * MIN)
  expect(w.forks.length).toBe(0)
  await clock.advance(11 * MIN)
  expect(w.forks.length).toBe(1)
})

test('no pings for a small context', OPT, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  const small = world(on, { tokens: 40000 })
  await $.session.start(session)
  await $.turn.complete(turn())
  await clock.advance(120 * MIN)
  expect(small.forks.length).toBe(0)
})

test('a nearly full weekly limit stops the pings', OPT, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  const w = world(on, { weekly: 96 })
  await $.session.start(session)
  await $.turn.complete(turn())
  await clock.advance(120 * MIN)
  expect(w.forks.length).toBe(0)
  expect(await why($)).toContain('weekly limit is at 96%')
})

test('/keepwarm off stops it, and a ping that finds the cache gone stops it', OPT, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  const w = world(on, { forks: [{ read: 0, write: 200000 }] })
  await $.session.start(session)
  await $.turn.complete(turn())
  await clock.advance(51 * MIN)
  expect(w.forks.length).toBe(1)
  await clock.advance(200 * MIN)
  expect(w.forks.length).toBe(1)
  expect(await why($)).toContain('already gone')
  await $.turn.complete(turn())
  await $.command.run({ command: 'keepwarm', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await clock.advance(200 * MIN)
  expect(w.forks.length).toBe(1)
})

test('only the configured project folders are warmed, and they carry the handoff rule', OPT, async ($, on) => {
  expect(inScope(String.raw`C:\Users\dev\work\other`, ["C:/Users/dev/work"])).toBe(true)
  expect(inScope('c:/users/dev/work/app/.claude/worktrees/x', ['C:/Users/dev/work'])).toBe(true)
  expect(inScope('C:/Users/dev/elsewhere', ['C:/Users/dev/work'])).toBe(false)
  expect(inScope('C:/Users/dev/elsewhere', [])).toBe(true)
  const clock = mock.clock(on, { now: START })
  const w = world(on)
  await $.session.start({ ...session, cwd: 'C:/Users/dev/elsewhere' })
  await $.turn.complete(turn())
  await clock.advance(120 * MIN)
  expect(w.forks.length).toBe(0)
})

test('the model can switch it off through the tool, and the handoff rule is in the system prompt', OPT, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  const w = world(on)
  await $.session.start(session)
  await $.turn.complete(turn())
  const composed = await $.prompt.compose({ promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)
  expect(composed.sections.some(x => x.id === 'keep-warm:handoff' && x.text.includes('NEW, separate session'))).toBe(true)
  await $.tool.call({ tool: 'mcp__stool__keep_warm', on: false } as never)
  await clock.advance(200 * MIN)
  expect(w.forks.length).toBe(0)
  expect(await why($)).toContain('off for this session')
})
