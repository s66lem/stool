// burn-pace: /burn opens a pane with one chart of this week's weekly-limit burn, read from the usage-pace log
import type { EngineInterface, Register, Timer } from 'claude-code'

import { expand } from '../config'
// the file usage-pace appends a reading to (its usageLog option)
const USAGE_LOG = '~/.claude/stool/usage-log.jsonl'

const H = 3600_000
const WEEK = 168 * H
const PANE = 'burn-pace'
const TITLE = 'Weekly burn'
const MAX_POINTS = 300
const ACCENT = '#d97757'
const GREY = '#8a8a8a'

/** One weekly reading: when (epoch ms) and its percent used. Oldest first. */
export type Point = { t: number; week: number }
export type Week = { start: number; reset: number; points: Point[] }

/** This week's readings from the log text: the lines whose weekResetsAt is the latest one, by time. */
export function currentWeek(log: string): Week | undefined {
  const rows: { t: number; week: number; reset: number }[] = []
  for (const l of log.split('\n')) {
    try {
      const r = JSON.parse(l)
      const reset = Date.parse(r.weekResetsAt)
      if (typeof r.t === 'number' && typeof r.week === 'number' && Number.isFinite(reset)) rows.push({ t: r.t, week: r.week, reset })
    } catch {}
  }
  if (rows.length === 0) return undefined
  const reset = Math.max(...rows.map(r => r.reset))
  const points = rows.filter(r => r.reset === reset).map(({ t, week }) => ({ t, week })).sort((a, b) => a.t - b.t)
  return { start: reset - WEEK, reset, points }
}

export type Projection = {
  now: number // percent used at the last reading
  per24h: number // points gained per 24 h over the last 24 h
  atReset: number // percent at the reset at that pace
  outAt: number | null // when it crosses 100%, if before the reset
}

/** The pace of the last 24 h (from the last reading at or before 24 h ago, else the week's first), carried to the reset. */
export function project(w: Week, nowMs: number): Projection {
  // currentWeek never returns a week without points
  const last = w.points[w.points.length - 1]!
  const base = [...w.points].reverse().find(p => p.t <= nowMs - 24 * H) ?? w.points[0]!
  const rate = last.t > base.t ? Math.max(0, last.week - base.week) / (last.t - base.t) : 0 // percent per ms
  const left = Math.max(0, w.reset - nowMs)
  const atReset = last.week + rate * left
  const toFull = rate > 0 ? (100 - last.week) / rate : Infinity
  return { now: last.week, per24h: rate * 24 * H, atReset, outAt: last.week < 100 && toFull <= left ? nowMs + toFull : null }
}

/** Every k-th point so at most `max` remain, the last always kept. */
export function downsample<T>(xs: T[], max = MAX_POINTS): T[] {
  if (xs.length <= max) return xs
  const k = Math.ceil(xs.length / max)
  const out = xs.filter((_, i) => i % k === 0)
  const tail = xs[xs.length - 1] as T
  if (out[out.length - 1] !== tail) out.push(tail)
  return out.slice(-max)
}

const fmt = (ms: number, o: Intl.DateTimeFormatOptions, timeZone?: string) => new Intl.DateTimeFormat('en-US', { ...o, timeZone }).format(ms)
/** "Tue 7pm" / "Tue 7:30pm", local time. */
export const at = (ms: number, timeZone?: string) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
      .formatToParts(ms)
      .map(x => [x.type, x.value]),
  )
  return `${p.weekday} ${p.hour}${p.minute === '00' ? '' : `:${p.minute}`}${String(p.dayPeriod).toLowerCase()}`
}

export const summary = (p: Projection) =>
  `now ${Math.round(p.now)}% · last 24h +${p.per24h.toFixed(1)} pts · projected ${Math.round(p.atReset)}% at reset`

/** The chart: actual, even pace, and the projection to the reset or to 100%. */
export function chart(w: Week, p: Projection, nowMs: number, timeZone?: string): string {
  const [W, Ht, L, R, T, B] = [640, 260, 40, 16, 14, 30]
  const yMax = Math.max(100, ...w.points.map(q => q.week)) * 1.08
  const x = (t: number) => (L + ((t - w.start) / WEEK) * (W - L - R)).toFixed(1)
  const y = (v: number) => (T + (1 - v / yMax) * (Ht - T - B)).toFixed(1)
  const pts = downsample(w.points.filter(q => q.t >= w.start))
  const g: string[] = []
  for (const v of [0, 50, 100])
    g.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${GREY}" stroke-opacity="${v === 100 ? 0.6 : 0.25}" stroke-width="1"/>`,
      `<text x="${L - 6}" y="${y(v)}" dy="4" text-anchor="end">${v}%</text>`)
  for (let d = 0; d < 7; d++) g.push(`<text x="${x(w.start + (d + 0.5) * 24 * H)}" y="${Ht - 10}" text-anchor="middle">${fmt(w.start + d * 24 * H, { weekday: 'short' }, timeZone)}</text>`)
  g.push(`<line x1="${x(w.start)}" y1="${y(0)}" x2="${x(w.reset)}" y2="${y(100)}" stroke="${GREY}" stroke-width="1" stroke-dasharray="3 4"/>`)
  if (pts.length) g.push(`<polyline fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linejoin="round" points="${pts.map(q => `${x(q.t)},${y(q.week)}`).join(' ')}"/>`)
  const now = Math.min(Math.max(nowMs, w.start), w.reset)
  const [endT, endV] = p.outAt !== null ? [p.outAt, 100] : [w.reset, p.atReset]
  g.push(`<line x1="${x(now)}" y1="${y(p.now)}" x2="${x(endT)}" y2="${y(endV)}" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="5 4"/>`)
  const label = p.outAt !== null ? `out ${at(p.outAt, timeZone)}` : `ends at ${Math.round(p.atReset)}%`
  const anchor = Number(x(endT)) > W - 120 ? 'end' : 'start'
  g.push(`<circle cx="${x(endT)}" cy="${y(endV)}" r="3.5" fill="${ACCENT}"/>`,
    `<text x="${x(endT)}" y="${y(endV)}" dx="${anchor === 'end' ? -6 : 6}" dy="-6" text-anchor="${anchor}" fill="${ACCENT}">${label}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" font-family="system-ui, sans-serif" font-size="11" fill="${GREY}">${g.join('')}</svg>`
}

async function readWeek($: EngineInterface): Promise<Week | undefined> {
  const file = expand((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')), USAGE_LOG)
  return currentWeek(await $.fs.read(file).catch(() => ''))
}

export const register: Register = on => {
  let tick: Timer | undefined
  const stop = () => {
    tick?.cancel()
    tick = undefined
  }

  on('session.start', { cwd: /[^]*|a{51}/ }, async ($, e, next) => {
    await $.command.register({ name: 'burn', description: 'Show or hide the weekly burn chart' })
    return next(e)
  })

  on('command.run', { command: 'burn' }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Weekly burn closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    stop()
    // redraw each minute while open: a reading usage-pace logged shows within a minute
    tick = $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    return { text: 'Weekly burn opened.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stop()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [w, nowMs] = [await readWeek($), await $.clock.now()]
    if (!w) return <Text dimColor>No weekly readings yet: turn on stool's Usage log option (usageLog).</Text>
    const p = project(w, nowMs)
    const line = summary(p)
    // the terminal has no Svg: the one line alone
    if (!('Svg' in els)) return <Text>{line}</Text>
    const { Svg } = els
    return (
      <Box flexDirection="column">
        <Svg source={chart(w, p, nowMs)} alt={`Weekly usage this week: ${line}`} />
        <Text dimColor>{line}</Text>
      </Box>
    )
  })
}
