// the Weekly burn chart (the settings window in place, and the /burn pop-out window from the same math):
// usage-pace log, a readouts row (used, pace in pts/hr, week average, what you can spend to last until the reset,
// when it runs out), two projections (week average and the chosen pace window), the 100% limit, and an hourly
// pts/hr bar strip under the chart, sized for a narrow side pane; hover shows each hour's readout, buttons switch the range and the pace window
import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import { expand } from '../config'
import { USAGE_LOG } from '../usage-pace/register'
import type { BurnRange, BurnWindow } from '../../types'

const H = 3600_000
const WEEK = 168 * H
const MAX_POINTS = 300
const ACCENT = '#d97757'
const GREY = '#8a8a8a'
export const WINDOWS: BurnWindow[] = [1, 6, 24]
export const RANGES: BurnRange[] = ['week', '48h']

/** The chart's choices: the x range and the pace window the projection and the 'pace' readout use. */
export const burnOpts = atom({ plugin: 'stool', key: 'burn' } as const, { range: 'week', window: 24 } as { range: BurnRange; window: BurnWindow })

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

/** A pace carried from the last reading to the reset: where it ends, and when it crosses 100% if before the reset. */
export type Run = { rate: number; atReset: number; outAt: number | null }

export type Projection = {
  now: number // percent used at the last reading
  window: BurnWindow // hours the pace is measured over
  pace: Run // points per hour over the last `window` hours, carried to the reset
  avg: Run // the week's average points per hour so far, carried to the reset
  canSpend: number // points per hour that use exactly what is left by the reset
  hoursLeft: number
}

const run = (now: number, rate: number, nowMs: number, reset: number): Run => {
  const left = Math.max(0, reset - nowMs) / H
  const toFull = rate > 0 ? (100 - now) / rate : Infinity
  return { rate, atReset: now + rate * left, outAt: now < 100 && toFull <= left ? nowMs + toFull * H : null }
}

/** Percent at time t: the last reading at or before it (undefined before the first). */
const valueAt = (w: Week, t: number) => {
  let v: number | undefined
  for (const p of w.points) {
    if (p.t > t) break
    v = p.week
  }
  return v
}

/** Pace over the last `window` hours (from the last reading at or before then, else the week's first), the week
 * average, and the rate that lasts until the reset, each carried to the reset. */
export function project(w: Week, nowMs: number, window: BurnWindow = 24): Projection {
  // currentWeek never returns a week without points
  const last = w.points[w.points.length - 1]!
  const base = [...w.points].reverse().find(p => p.t <= nowMs - window * H) ?? w.points[0]!
  const rate = last.t > base.t ? Math.max(0, last.week - base.week) / ((last.t - base.t) / H) : 0
  const elapsed = (last.t - w.start) / H
  const avg = elapsed > 0 ? Math.max(0, last.week) / elapsed : 0
  const hoursLeft = Math.max(0, w.reset - nowMs) / H
  return {
    now: last.week,
    window,
    pace: run(last.week, rate, nowMs, w.reset),
    avg: run(last.week, avg, nowMs, w.reset),
    canSpend: hoursLeft > 0 ? Math.max(0, 100 - last.week) / hoursLeft : 0,
    hoursLeft,
  }
}

/** One bar per hour of the week up to now: the hour's start, the percent at its end (or now), the points gained. */
export type Hour = { t: number; pct: number; gain: number }
export function hourly(w: Week, nowMs: number): Hour[] {
  const out: Hour[] = []
  for (let t = w.start; t < Math.min(nowMs, w.reset); t += H) {
    const end = valueAt(w, Math.min(t + H, nowMs))
    if (end === undefined) continue
    out.push({ t, pct: end, gain: Math.max(0, end - (valueAt(w, t) ?? end)) })
  }
  return out
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

const f1 = (x: number) => x.toFixed(1)
/** The readouts, two short lines for a narrow pane: what is used and the paces; what lasts and when it runs out. */
export const readouts = (p: Projection, timeZone?: string): [string, string] => [
  `used ${Math.round(p.now)}% · pace ${f1(p.pace.rate)} pts/hr (${p.window} h) · avg ${f1(p.avg.rate)}`,
  `can spend ${f1(p.canSpend)} pts/hr · ` +
    (p.pace.outAt !== null ? `runs out ${at(p.pace.outAt, timeZone)}` : `lasts, ends ~${Math.round(p.pace.atReset)}%`),
]
export const summary = (p: Projection, timeZone?: string) => readouts(p, timeZone).join(' · ')

/** The x range drawn: the whole week, or 48 h around now (36 h back, 12 h ahead) kept inside the week. */
export function span(w: Week, nowMs: number, range: BurnRange): [number, number] {
  if (range === 'week') return [w.start, w.reset]
  const x0 = Math.min(Math.max(nowMs - 36 * H, w.start), w.reset - 48 * H)
  return [x0, x0 + 48 * H]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** The chart's frame, sized for a narrow side pane (it scales to the slot's width): viewBox width and height, plot
 * left and right edges, the legend row, plot top and bottom, the pts/hr strip, the font size. */
export const BOX = { W: 400, Ht: 300, L: 36, R: 8, legend: 14, T: 34, cB: 196, bT: 210, bB: 268, font: 12 } as const
/** Rough text width at the chart's font size (system-ui averages ~0.56 em), so a hover label's box fits its text. */
export const textWidth = (s: string) => Math.ceil(s.length * BOX.font * 0.56)

/** The hover readout's box for a guide at `gx`: right of the guide, flipped left of it near the right edge, kept
 * inside the viewBox. */
export function labelBox(gx: number, text: string): { x: number; w: number } {
  const w = textWidth(text) + 12
  const x = gx + 6 + w <= BOX.W - 1 ? gx + 6 : gx - 6 - w
  return { x: Math.round(Math.max(1, Math.min(x, BOX.W - 1 - w))), w }
}

/** The chart: a legend row, actual, both projections, the 100% limit, the hourly pts/hr strip with the can-spend
 * line, and one hit rect per hour whose hidden readout (label, guide line, dot on the line) shows on :hover. */
export function chart(w: Week, p: Projection, nowMs: number, timeZone?: string, range: BurnRange = 'week'): string {
  const { W, Ht, L, R, legend, T, cB, bT, bB, font } = BOX
  const [x0, x1] = span(w, nowMs, range)
  const yMax = Math.max(100, ...w.points.map(q => q.week)) * 1.08
  const xn = (t: number) => L + ((t - x0) / (x1 - x0)) * (W - L - R)
  const x = (t: number) => xn(t).toFixed(1)
  const yn = (v: number) => T + (1 - v / yMax) * (cB - T)
  const y = (v: number) => yn(v).toFixed(1)
  const hours = hourly(w, nowMs)
  const g: string[] = [
    `<style>.h .r{visibility:hidden;pointer-events:none}.h:hover .r{visibility:visible}</style>`,
    `<defs><clipPath id="pa"><rect x="${L}" y="0" width="${W - L - R}" height="${Ht}"/></clipPath></defs>`,
  ]
  for (const v of [0, 50, 100])
    g.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 100 ? ACCENT : GREY}" stroke-opacity="${v === 100 ? 0.55 : 0.25}" stroke-width="1"/>`,
      `<text x="${L - 5}" y="${y(v)}" dy="4" text-anchor="end">${v}%</text>`)
  if (range === 'week')
    for (let d = 0; d < 7; d++) g.push(`<text x="${x(w.start + (d + 0.5) * 24 * H)}" y="${Ht - 6}" text-anchor="middle">${fmt(w.start + d * 24 * H, { weekday: 'short' }, timeZone)}</text>`)
  else
    for (let t = Math.ceil(x0 / (12 * H)) * 12 * H; t <= x1; t += 12 * H)
      if (xn(t) > L + 24 && xn(t) < W - R - 24) g.push(`<text x="${x(t)}" y="${Ht - 6}" text-anchor="middle">${at(t, timeZone)}</text>`)
  const c: string[] = [] // clipped to the plot area
  c.push(`<line x1="${x(w.start)}" y1="${y(0)}" x2="${x(w.reset)}" y2="${y(100)}" stroke="${GREY}" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="1 3"/>`)
  const shown = w.points.filter((q, i, a) => q.t >= x0 || (a[i + 1]?.t ?? Infinity) >= x0)
  const pts = downsample(shown)
  if (pts.length) c.push(`<polyline fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linejoin="round" points="${pts.map(q => `${x(q.t)},${y(q.week)}`).join(' ')}"/>`)
  const now = Math.min(Math.max(nowMs, w.start), w.reset)
  c.push(`<line x1="${x(now)}" x2="${x(now)}" y1="${T}" y2="${bB}" stroke="${GREY}" stroke-opacity="0.3" stroke-width="1"/>`)
  const end = (r: Run): [number, number] => (r.outAt !== null ? [r.outAt, 100] : [w.reset, r.atReset])
  const [aT, aV] = end(p.avg)
  c.push(`<line x1="${x(now)}" y1="${y(p.now)}" x2="${x(aT)}" y2="${y(aV)}" stroke="${GREY}" stroke-width="1.5" stroke-dasharray="5 4"/>`)
  const [eT, eV] = end(p.pace)
  c.push(`<line x1="${x(now)}" y1="${y(p.now)}" x2="${x(eT)}" y2="${y(eV)}" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="5 4"/>`)
  if (eT <= x1) {
    const label = p.pace.outAt !== null ? `out ${at(p.pace.outAt, timeZone)}` : `ends ~${Math.round(p.pace.atReset)}%`
    const anchor = xn(eT) > W - 90 ? 'end' : 'start'
    c.push(`<circle cx="${x(eT)}" cy="${y(eV)}" r="3.5" fill="${ACCENT}"/>`,
      `<text x="${x(eT)}" y="${y(eV)}" dx="${anchor === 'end' ? -6 : 6}" dy="-7" text-anchor="${anchor}" fill="${ACCENT}">${label}</text>`)
  }
  // the pts/hr strip: one bar per hour, scaled so the can-spend line and the tallest bar both fit
  const bMax = Math.max(0.5, p.canSpend * 1.5, ...hours.map(q => q.gain))
  const by = (v: number) => (bB - (v / bMax) * (bB - bT)).toFixed(1)
  const bw = Math.max(1, (W - L - R) / ((x1 - x0) / H) - 0.6).toFixed(1)
  const inView = hours.filter(q => q.t + H > x0 && q.t < x1)
  for (const q of inView) if (q.gain > 0) c.push(`<rect x="${x(q.t)}" y="${by(q.gain)}" width="${bw}" height="${(Number(by(0)) - Number(by(q.gain))).toFixed(1)}" fill="${ACCENT}" fill-opacity="0.75"/>`)
  c.push(`<line x1="${L}" x2="${W - R}" y1="${bB}" y2="${bB}" stroke="${GREY}" stroke-opacity="0.35" stroke-width="1"/>`,
    `<line x1="${L}" x2="${W - R}" y1="${by(p.canSpend)}" y2="${by(p.canSpend)}" stroke="${GREY}" stroke-opacity="0.6" stroke-width="1" stroke-dasharray="2 3"/>`)
  g.push(`<g clip-path="url(#pa)">${c.join('')}</g>`)
  g.push(`<text x="${L - 5}" y="${bT + 4}" text-anchor="end">/hr</text>`,
    `<text x="${W - R}" y="${by(p.canSpend)}" dy="-4" text-anchor="end">can spend ${f1(p.canSpend)}/h</text>`)
  // legend: its own row above the plot
  const lg = (dx: number, color: string, dash: string, text: string) =>
    `<line x1="${L + dx}" x2="${L + dx + 16}" y1="${legend - 4}" y2="${legend - 4}" stroke="${color}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/><text x="${L + dx + 20}" y="${legend}">${text}</text>`
  g.push(lg(0, ACCENT, '', 'actual'), lg(68, GREY, '4 3', 'week avg'), lg(152, ACCENT, '4 3', `last ${p.window} h pace`))
  // hover: one hit rect per hour (adjacent, never overlapping) over chart and strip; its readout is hidden until
  // :hover: a guide line, a dot on the line (actual, or the pace projection ahead of now) and a label at the top
  const byT = new Map(hours.map(q => [q.t, q]))
  for (let t = Math.max(w.start, Math.floor((x0 - w.start) / H) * H + w.start); t < x1; t += H) {
    const q = byT.get(t)
    const ahead = Math.min(p.now + p.pace.rate * ((t + H - nowMs) / H), p.pace.outAt !== null ? 100 : Infinity)
    const [tip, v]: [string, number | undefined] = q
      ? [`${at(t, timeZone)} · ${Math.round(q.pct)}% · +${f1(q.gain)}/h`, q.pct]
      : t >= nowMs
        ? [`${at(t, timeZone)} · ~${Math.round(Math.min(ahead, 999))}% at pace`, ahead]
        : [`${at(t, timeZone)} · no reading`, undefined]
    const [ra, rb] = [Math.max(xn(t), L), Math.min(xn(t + H), W - R)]
    const gx = (ra + rb) / 2
    const lb = labelBox(gx, tip)
    const dot = v !== undefined && yn(v) >= T ? `<circle cx="${gx.toFixed(1)}" cy="${y(v)}" r="3.5" fill="${ACCENT}" stroke="white" stroke-width="1.5"/>` : ''
    g.push(`<g class="h"><rect x="${ra.toFixed(1)}" y="${T}" width="${(rb - ra).toFixed(1)}" height="${bB - T}" fill="transparent"/>` +
      `<g class="r"><line x1="${gx.toFixed(1)}" x2="${gx.toFixed(1)}" y1="${T}" y2="${bB}" stroke="${GREY}" stroke-width="1"/>${dot}` +
      `<rect x="${lb.x}" y="${T + 1}" width="${lb.w}" height="${font + 8}" rx="4" fill="#2b2b2b" fill-opacity="0.92"/>` +
      `<text x="${lb.x + 6}" y="${T + font + 3}" fill="white">${esc(tip)}</text></g></g>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Ht}" style="width:100%;height:auto;display:block" font-family="system-ui, sans-serif" font-size="${font}" fill="${GREY}">${g.join('')}</svg>`
}

/** The readouts, the chart and its range / pace-window buttons; the terminal (no Svg) gets the readouts alone.
 * Needs usage-pace's usageLog on. One view for /burn and the settings window. */
export async function burnView($: EngineInterface, e: RenderInput<'Pane'>, isLogOn: boolean) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  if (!isLogOn) return <Text dimColor>Weekly burn needs Log meter readings (usageLog) switched on.</Text>
  const file = expand((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')), USAGE_LOG)
  const [w, nowMs, o] = [currentWeek(await $.fs.read(file).catch(() => '')), await $.clock.now(), await read($, burnOpts)]
  if (!w) return <Text dimColor>No weekly readings logged yet.</Text>
  const p = project(w, nowMs, o.window)
  const [l1, l2] = readouts(p)
  const lines = (
    <Box key="burn-readouts" flexDirection="column">
      <Text>{l1}</Text>
      <Text>{l2}</Text>
    </Box>
  )
  if (e.surface === 'terminal' || !('Svg' in els)) return lines
  const { Svg } = els
  const pick = <K extends 'range' | 'window'>(k: K, v: (typeof o)[K], label: string) => (
    <Button
      key={`burn-${k}-${v}`}
      {...(o[k] === v ? { variant: 'primary' as const } : { plain: true })}
      label={label}
      onPress={() => update($, burnOpts, x => ({ ...x, [k]: v }))}
    />
  )
  return (
    <Box flexDirection="column">
      {lines}
      <Svg source={chart(w, p, nowMs, undefined, o.range)} alt={`Weekly usage this week: ${l1} · ${l2}`} isInteractive />
      <Box key="burn-picks" flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={1}>
        <Box key="burn-range" flexDirection="row" gap={1}>
          <Text dimColor>range</Text>
          {pick('range', 'week', 'Week')}
          {pick('range', '48h', '48 h')}
        </Box>
        <Box key="burn-window" flexDirection="row" gap={1}>
          <Text dimColor>pace</Text>
          {WINDOWS.map(n => pick('window', n, `${n} h`))}
        </Box>
      </Box>
    </Box>
  )
}
