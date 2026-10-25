// keep-warm: the warming loop of karanb192/cache-tax (MIT), without its arming command, cold-send guard or band.
// It arms itself after every turn of a big session and gives up after MAX_PINGS idle pings in a row.
import type { EngineInterface, Register, ToolSpec } from 'claude-code'

import type { KeepWarmStrip } from '../../types'
import { flag, inScope, roots } from '../config'

const MIN = 60_000
// the main prompt cache lives one hour from the last request: ping at 50 minutes, ten minutes clear
const PING_AFTER_MS = 50 * MIN
// a ping costs about 1/20 of re-writing the context cold, so past ~20 idle pings (about 17 hours) warming costs more
// than it saves; 15 covers a long day or a night away. /keepwarm <count> changes it for this session
export const MAX_PINGS = 15
// under this many context tokens a cold re-write is cheap: not worth a model request every 50 minutes
export const MIN_CTX = 100_000
// a 5-hour or weekly window this full has nothing to spare for pings
const STOP_AT_PERCENT = 95
const TOOL = 'mcp__stool__keep_warm'
// constant text: a system prompt that changed between turns would itself break the cache
const RULE = {
  id: 'keep-warm:handoff',
  scope: 'session',
  text: `# Keep-warm
This session's prompt cache is kept warm while it idles (the keep-warm mod: a small model request every 50 idle minutes, up to ${MAX_PINGS} in a row). When the user asks you to write a handoff for a NEW, separate session (not a /clear or restart of this same session), ask them in chat, in one line, whether keep-warm should be turned off for this session, since it would otherwise keep pinging a session they are leaving. If they say yes, call the ${TOOL} tool with {"on": false} and confirm. Do not turn it off without their answer.`,
} as const
const PROMPT = 'This is an automated cache keep-alive, not a message from the user. Reply with the single word: warm'

export type State = {
  lastRequestAt: number // the last main-thread model request (a turn's step, or a warm ping)
  ctx: number // context tokens after the last turn; 0 = unknown (new, cleared, compacted)
  pings: number // warm pings since the last real turn
  max: number
  off: boolean
  scoped: boolean // started under `projectRoots` (or anywhere when none is set), or switched on by hand
  note: string | undefined // why warming stopped, until the next turn
  cancel: (() => void) | null
  lastPingAt: number | null // the last warm ping, for the strip
  nextAt: number | undefined
  coldCancel: (() => void) | null
}
export const freshState = (): State => ({ lastRequestAt: 0, ctx: 0, pings: 0, max: MAX_PINGS, off: false, scoped: false, note: undefined, cancel: null, lastPingAt: null, nextAt: undefined, coldCancel: null })

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase()

const STRIP = { plugin: 'stool', key: 'warm' } as const

// the strip above the progress bars draws "pings/max | last ping"
function show($: EngineInterface, s: State, nextAt?: number) {
  const strip: KeepWarmStrip = {
    pings: s.pings,
    max: s.max,
    lastAt: s.lastPingAt,
    coldAt: s.lastRequestAt ? s.lastRequestAt + 60 * MIN : null,
  }
  void $.state.set(STRIP, strip)
  s.nextAt = nextAt
  // the strip turns to "cold" by the clock: publish once more as the hour runs out, so it is drawn again then
  s.coldCancel?.()
  s.coldCancel = null
  const coldAt = strip.coldAt
  if (coldAt !== null)
    void $.clock.now().then(now => {
      if (coldAt > now) s.coldCancel = $.clock.after(coldAt - now + 1000, () => void $.state.set(STRIP, { ...strip })).cancel
    })
}

function stop($: EngineInterface, s: State, note: string) {
  s.cancel?.()
  s.cancel = null
  s.note = note
  show($, s)
}

async function arm($: EngineInterface, s: State) {
  s.cancel?.()
  s.cancel = null
  if (!s.scoped) return show($, s) // outside `projectRoots`: silent
  if (s.off) return stop($, s, 'switched off (/keepwarm on)')
  if (!s.lastRequestAt || s.ctx < MIN_CTX) return show($, s) // nothing worth warming: say nothing
  if (s.pings >= s.max) return stop($, s, `${s.max} pings sent with no reply from you; it goes cold at ${clock(s.lastRequestAt + 60 * MIN)}`)
  const at = s.lastRequestAt + PING_AFTER_MS
  s.note = undefined
  s.cancel = $.clock.after(Math.max(1000, at - (await $.clock.now())), () => void ping($, s)).cancel
  show($, s, at)
}

async function ping($: EngineInterface, s: State) {
  s.cancel = null
  const now = await $.clock.now()
  if (now - s.lastRequestAt < PING_AFTER_MS - 1000) return // a turn ran meanwhile and re-armed: this timer is stale
  if (now - s.lastRequestAt >= 60 * MIN) return stop($, s, 'it was already cold (the PC slept?)') // never pay to warm a cold cache
  const full = (await $.session.usage()).rateLimits.find(l => l.percentUsed >= STOP_AT_PERCENT)
  if (full) return stop($, s, `the ${full.kind === 'five_hour' ? '5-hour' : 'weekly'} limit is at ${Math.round(full.percentUsed)}%`)
  let r
  try {
    r = await $.model.fork({ prompt: PROMPT })
  } catch (err) {
    return stop($, s, `the ping failed (${err instanceof Error ? err.message : String(err)})`)
  }
  if (!r || !r.isAnswered) return stop($, s, `the ping got no answer (${r ? r.reason : 'not sent'})`)
  const u = r.usage
  // a warm ping reads the whole context and writes only its own line; a big write means the cache was gone already
  if (!(u.cache_read_input_tokens > 0 && u.cache_creation_input_tokens < 0.1 * u.cache_read_input_tokens))
    return stop($, s, `the last ping re-wrote ${Math.round(u.cache_creation_input_tokens / 1000)}k tokens: the cache was already gone`)
  s.pings += 1
  s.lastPingAt = now
  s.lastRequestAt = now
  await arm($, s)
}

export const KEEP_WARM_TOOL: ToolSpec = {
  name: 'keep_warm',
  description:
    "Turn this session's idle cache warming off or on. Call it only after the user has answered, in chat, whether keep-warm should be turned off (for example when they hand this session's work off to a new session).",
  inputSchema: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
  isDeferred: true,
}

export const register: Register = (on, options) => {
  if (options?.keepWarm === false) return
  const s = freshState()

  on('session.start', { cwd: /[^]*|a{8}/ }, async ($, e, next) => {
    await $.command.register({
      name: 'keepwarm',
      description: `Idle cache warming for this session: off, on, or a number of pings (default ${MAX_PINGS}, one per 50 idle minutes)`,
    })
    s.scoped = inScope(e.cwd, roots(options))
    if (s.scoped)
      await $.tool.register(KEEP_WARM_TOOL)
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // the tool's arguments sit on the event itself (a first version read `e.input`, which is undefined: the hook threw
    // and the call went unanswered, 2026-10-13)
    s.off = (e as unknown as { on?: unknown }).on !== true
    await arm($, s)
    return { result: s.off ? 'keep-warm is off for this session' : 'keep-warm is on for this session' }
  })

  on('prompt.compose', { promptModel: /[^]*|a{9}/ }, async ($, e, next) => {
    const r = await next(e)
    return s.scoped ? { sections: [...r.sections, RULE] } : r
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const n = Number(arg)
    if (arg === 'off') s.off = true
    else if (arg === 'on') {
      s.off = false
      s.scoped = true
    }
    else if (Number.isInteger(n) && n >= 1 && n <= 40) s.max = n
    else if (arg !== '') return { text: 'keepwarm: off, on, or a number of pings from 1 to 40' }
    if (arg !== '') await arm($, s) // (a bare /keepwarm only reports: it must not restart a loop that stopped)
    return {
      text: s.off
        ? 'keepwarm is off for this session'
        : !s.scoped
          ? 'keepwarm does not run here (outside the configured project folders); /keepwarm on to switch it on for this session'
        : s.cancel
          ? `keepwarm: ping ${s.pings + 1} of ${s.max} at ${clock(s.lastRequestAt + PING_AFTER_MS)} if the session stays idle`
          : `keepwarm is on, up to ${s.max} pings; ${s.note ?? `nothing to warm yet (under ${MIN_CTX / 1000}k tokens of context, or no turn so far)`}`,
    }
  })

  on('turn.step', { model: /[^]*|a{10}/ }, async function* ($, e, next) {
    if (!e.agentId) s.lastRequestAt = await $.clock.now()
    yield* next(e)
  })

  on('turn.complete', { reason: /[^]*|a{11}/ }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const now = await $.clock.now()
    if (now - s.lastRequestAt > e.durationMs) s.lastRequestAt = now // (no step stamped this turn: its end is the floor)
    s.pings = 0
    const u = e.usage
    const live = (await $.session.usage()).context.tokens
    s.ctx = live && live > 0 ? live : u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : s.ctx
    await arm($, s)
    return r
  })

  // a compaction or a /clear replaces the context: nothing known to warm until the next turn
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      s.ctx = 0
      await arm($, s)
    }
    return r
  })
  on('classic.SessionStart', { source: /[^]*|a{41}/ }, async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear') {
      s.ctx = 0
      s.pings = 0
      s.lastRequestAt = 0
      await arm($, s)
    }
    return r
  })
}
