import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { UsageStrip, UsageWindow } from '../../types'

const H = 3600_000
const WINDOW_MS: Record<string, number> = { five_hour: 5 * H, seven_day: 168 * H }
// before this much of a window has passed one burst reads as a rate: raise it if the warning cries wolf
const MIN_ELAPSED_MS = 15 * 60_000
// the 5-hour pace is the trend over the last TREND_MS of readings, once they span MIN_TREND_MS;
// until then (a new session, a new window) it is the window's average so far
const TREND_MS = 30 * 60_000
const MIN_TREND_MS = 10 * 60_000

/** One reading of the 5-hour window: when, and its percent used. Oldest first. */
export type Sample = { t: number; used: number }

// the agent-cap policy's knobs (parallel Sonnet/Opus agents an orchestrator may have running)
const BASE = 6 // on pace
const EASED = 4 // the 5-hour window would run out early, or the weekly would
const TIGHT = 2 // the 5-hour window would run out well early: projected past BAD_PERCENT
const BAD_PERCENT = 140
const STOP_AT = 95 // percent of the 5-hour window used: start nothing new
const ALL_OUT = 8 // the weekly resets within ALL_OUT_MS with quota that would go unused
const ALL_OUT_MS = 24 * H
const UNUSED_BELOW = 90 // projected weekly percent under which quota counts as going unused

const span = (ms: number) => {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const hm = `${Math.floor((m % 1440) / 60)}h${String(m % 60).padStart(2, '0')}m`
  return m < 1440 ? hm : `${Math.floor(m / 1440)}d${hm}`
}

/** A moment as local clock time, "5am" or "9:36pm", with the weekday when it is not today: "Thursday 5am". */
export const when = (ms: number, nowMs: number, timeZone?: string) => {
  const parts = (t: number) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
        .formatToParts(t)
        .map(p => [p.type, p.value]),
    )
  const [a, n] = [parts(ms), parts(nowMs)]
  const time = `${a.hour}${a.minute === '00' ? '' : `:${a.minute}`}${a.dayPeriod.toLowerCase()}`
  return a.day === n.day && Math.abs(ms - nowMs) < 24 * H ? time : `${a.weekday} ${time}`
}

/** When a window runs out at its pace, against its reset: "out Tuesday 9pm (in 1d5h36m), 1d12h24m before its reset". */
export const runsOut = (p: Pace, nowMs: number, timeZone?: string) =>
  p.toLimitMs === Infinity
    ? 'not running out at this pace'
    : p.toLimitMs < p.leftMs
      ? `out ${when(nowMs + p.toLimitMs, nowMs, timeZone)} (in ${span(p.toLimitMs)}), ${span(p.leftMs - p.toLimitMs)} before its reset`
      : `would run out ${span(p.toLimitMs - p.leftMs)} after its reset`

export type Pace = { used: number; projected: number; leftMs: number; toLimitMs: number }

/** One window's pace: percent used, the percent it would reach at its reset, time to the reset and to 100%. */
function pace(limits: SessionRateLimit[], kind: string, nowMs: number, samples: Sample[] = []): Pace | undefined {
  const w = limits.find(l => l.kind === kind)
  if (!w?.resetsAt || w.percentUsed <= 0) return undefined
  const resetsAt = Date.parse(w.resetsAt)
  const elapsed = nowMs - (resetsAt - WINDOW_MS[kind])
  const from = samples.find(s => s.t >= nowMs - TREND_MS)
  const hasTrend = from !== undefined && nowMs - from.t >= MIN_TREND_MS
  if (!hasTrend && elapsed < MIN_ELAPSED_MS) return undefined
  // percent per ms
  const rate = hasTrend ? Math.max(0, w.percentUsed - from.used) / (nowMs - from.t) : w.percentUsed / elapsed
  const leftMs = resetsAt - nowMs
  return {
    used: w.percentUsed,
    projected: w.percentUsed + rate * leftMs,
    leftMs,
    toLimitMs: rate > 0 ? (100 - w.percentUsed) / rate : Infinity,
  }
}

/** Adds a reading of the 5-hour window to the samples (in place): a new window starts them over. */
export function note(samples: Sample[], limits: SessionRateLimit[], nowMs: number): void {
  const w = limits.find(l => l.kind === 'five_hour')
  if (!w) return
  const last = samples[samples.length - 1]
  if (last && w.percentUsed < last.used) samples.length = 0
  samples.push({ t: nowMs, used: w.percentUsed })
  while (samples.length > 1 && samples[1].t <= nowMs - TREND_MS) samples.shift()
}

/** The warning line, or undefined when the 5-hour window lasts to its reset at the pace so far. */
export function line(limits: SessionRateLimit[], nowMs: number, samples: Sample[] = []): string | undefined {
  const p = pace(limits, 'five_hour', nowMs, samples)
  if (!p || p.used >= 100 || p.toLimitMs >= p.leftMs) return undefined
  return `5h limit: ${Math.round(p.used)}% used. At this pace you hit it in ~${span(p.toLimitMs)}, ${span(p.leftMs - p.toLimitMs)} before it resets.`
}

/** How many agents to run in parallel for new dispatches, and why. */
export function cap(limits: SessionRateLimit[], nowMs: number, samples: Sample[] = []): { cap: number; why: string } {
  const five = pace(limits, 'five_hour', nowMs, samples)
  const week = pace(limits, 'seven_day', nowMs)
  if (five && five.used >= STOP_AT) return { cap: 0, why: `5h window at ${Math.round(five.used)}%: start nothing new` }
  if (week && week.leftMs < ALL_OUT_MS && week.projected < UNUSED_BELOW)
    return {
      cap: ALL_OUT,
      why: `weekly resets ${when(nowMs + week.leftMs, nowMs)} (in ${span(week.leftMs)}) on pace for only ${Math.round(week.projected)}%: use it up`,
    }
  if (five && five.projected > 100)
    return {
      cap: five.projected > BAD_PERCENT ? TIGHT : EASED,
      why: `5h window on pace for ${Math.round(five.projected)}%, ${runsOut(five, nowMs)}`,
    }
  if (week && week.projected > 100)
    return { cap: EASED, why: `weekly on pace for ${Math.round(week.projected)}%, ${runsOut(week, nowMs)}` }
  return { cap: BASE, why: 'on pace' }
}

const report = (limits: SessionRateLimit[], nowMs: number, samples: Sample[]) => {
  const c = cap(limits, nowMs, samples)
  const row = (label: string, kind: string) => {
    const p = pace(limits, kind, nowMs, kind === 'five_hour' ? samples : [])
    return p
      ? `${label}: ${Math.round(p.used)}% used, on pace for ${Math.round(p.projected)}% at its reset (${when(nowMs + p.leftMs, nowMs)}, in ${span(p.leftMs)}); ${runsOut(p, nowMs)}.`
      : `${label}: no projection yet.`
  }
  return `Agent cap ${c.cap} (${c.why}). ${row('5h', 'five_hour')} ${row('Weekly', 'seven_day')} The 5h pace is the last 30 minutes' trend once this session has 10 minutes of readings (the window's average before that); the weekly pace is its average. Times are local. The cap is for new dispatches: never stop running agents for it.`
}

const STRIP = { plugin: 'stool', key: 'usage' } as const

/** What the strip above the progress bars draws for one window: its reading even before it has a pace. */
function windowOf(limits: SessionRateLimit[], kind: string, nowMs: number, samples: Sample[] = []): UsageWindow | null {
  const w = limits.find(l => l.kind === kind)
  if (!w?.resetsAt) return null
  const p = pace(limits, kind, nowMs, samples)
  return {
    used: w.percentUsed,
    resetAt: Date.parse(w.resetsAt),
    projected: p ? p.projected : null,
    limitAt: p && p.toLimitMs !== Infinity ? nowMs + p.toLimitMs : null,
  }
}

/** Every token this account's sessions spent since the weekly window opened, kept across sessions in the store. */
// ponytail: read-add-write with no lock, so two sessions ending a turn in the same instant can lose one turn's count;
// it also counts only sessions with this mod loaded, from the day it was installed. A ledger file if that matters.
async function addTokens($: EngineInterface, limits: SessionRateLimit[], add: number): Promise<number> {
  const week = limits.find(l => l.kind === 'seven_day')?.resetsAt ?? 'unknown'
  const key = `tokens:${week}`
  const total = (((await $.store.get(key)) as number | undefined) ?? 0) + add
  if (add > 0) await $.store.set(key, total)
  return total
}

async function publish($: EngineInterface, limits: SessionRateLimit[], now: number, samples: Sample[], add = 0) {
  const strip: UsageStrip = {
    cap: cap(limits, now, samples).cap,
    weekly: windowOf(limits, 'seven_day', now),
    five: windowOf(limits, 'five_hour', now, samples),
    tokens: await addTokens($, limits, add),
  }
  await $.state.set(STRIP, strip)
}

export const register: Register = on => {
  let wasEarly = false
  const samples: Sample[] = []

  on('session.start', { cwd: /[^]*|a{29}/ }, async ($, e, next) => {
    await $.tool.register({
      name: 'agent_cap',
      description:
        'How many agents to run in parallel right now, from the pace of the 5-hour and weekly usage windows. Call it before dispatching a batch of agents; the cap governs new dispatches only.',
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })

    return next(e)
  })

  on('tool.call', { tool: 'mcp__stool__agent_cap' }, async $ => {
    const [{ rateLimits }, now] = [await $.session.usage(), await $.clock.now()]
    note(samples, rateLimits, now)
    await publish($, rateLimits, now, samples)

    return { result: report(rateLimits, now, samples) }
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    note(samples, e.rateLimits, now)
    const warning = line(e.rateLimits, now, samples)
    //
    await publish($, e.rateLimits, now, samples)
    if (warning !== undefined && !wasEarly) $.ui.toast(warning)
    wasEarly = warning !== undefined

    return next(e)
  })

  // every turn's tokens, subagents' included, go on this week's count
  on('turn.complete', { reason: /[^]*|a{30}/ }, async ($, e, next) => {
    const r = await next(e)
    const u = e.usage
    if (u) {
      const now = await $.clock.now()
      const { rateLimits } = await $.session.usage()
      const spent = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      await publish($, rateLimits, now, samples, spent)
    }
    return r
  })
}
