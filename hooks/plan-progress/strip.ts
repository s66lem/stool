// The usage strip above the bars: agent cap (used/cap), weekly and 5-hour usage, keep-warm, context %.
// Sizes, colours, gaps and icons are a Figma frame; the numbers come from the
// usage-pace and keep-warm mods through their own `strip` state (types/index.d.ts).
import type { KeepWarmStrip, RestartStrip, UsageStrip, UsageWindow } from '../../types'

import { ICONS } from './strip-icons'

const MIN = 60_000

/** A length of time: 2d3h, 2d, 3h20m, 8hr, 49min. Zero parts are left out, and minutes once it is a day or more. */
export function fmtSpan(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN))
  const [d, h, min] = [Math.floor(m / 1440), Math.floor((m % 1440) / 60), m % 60]
  if (d > 0) return h > 0 ? `${d}d${h}h` : `${d}d`
  if (h > 0) return min > 0 ? `${h}h${min}m` : `${h}hr`
  return `${min}min`
}

/** A clock time in the local zone: 12:40a, 5p. */
export function fmtClock(ms: number, timeZone?: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })
      .formatToParts(ms)
      .map(x => [x.type, x.value]),
  )
  return `${p.hour}${p.minute === '00' ? '' : `:${p.minute}`}${(p.dayPeriod ?? '').toLowerCase().startsWith('p') ? 'p' : 'a'}`
}

/** A count: 950, 13.3k, 2m, 13.3b, 1.2t. */
export function fmtCount(n: number): string {
  const units = ['', 'k', 'm', 'b', 't']
  let [v, i] = [Math.max(0, n), 0]
  while (v >= 999.5 && i < units.length - 1) {
    v /= 1000
    i += 1
  }
  const s = i === 0 || v >= 99.95 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '')
  return s + units[i]
}

// one piece of coloured text; `gap` is the room before it in px
// `tip` is the label the hover card shows for this piece, in the same colour; `mod` is the mod it comes from
type Span = { text: string; size: number; fill: string; gap?: number; tip?: string }
type Group = { icon: keyof typeof ICONS; iconGap: number; spans: Span[]; mod: string }

const FONT = `'Anthropic Sans Text','Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif`
const DASH = '#505050'

/** One usage window's two halves: `93% | 2d3h` and, when it has a pace, `- 147% | 8hr`. */
function windowSpans(w: UsageWindow, now: number, c: { main: string; bar: string; soft: string; softBar: string }, show: StripShow): Span[] {
  const out: Span[] = [{ text: `${Math.round(w.used)}%`, size: 15, fill: c.main, tip: '% Used' }]
  if (show.reset !== false)
    out.push({ text: ' |', size: 16, fill: c.bar, tip: '|' }, { text: ` ${fmtSpan(w.resetAt - now)}`, size: 15, fill: c.main, tip: 'Reset Date' })
  if (w.projected === null || show.projection === false) return out
  out.push({ text: '-', size: 16, fill: DASH, gap: 5, tip: '-' }, { text: `${Math.round(w.projected)}%`, size: 13, fill: c.soft, gap: 5, tip: '% Projected' })
  // the time it runs out is shown only when that is before the reset
  if (w.limitAt !== null && w.limitAt < w.resetAt)
    out.push({ text: ' |', size: 13, fill: c.softBar, tip: '|' }, { text: ` ${fmtSpan(w.limitAt - now)}`, size: 13, fill: c.soft, tip: 'Proj. Limit Hit' })
  return out
}

/** What the strip reads besides usage-pace and keep-warm: live Sonnet/Opus agents across sessions, restart-clock. */
/** What the strip shows: a group or a detail is drawn unless its flag is false (the `strip*` options). */
export type StripShow = { agents?: boolean; cheap?: boolean; codex?: boolean; weekly?: boolean; five?: boolean; warm?: boolean; context?: boolean; reset?: boolean; projection?: boolean }
export type Extra = { used?: number; cheap?: number; codex?: number; restart?: RestartStrip; show?: StripShow }

function groups(usage: UsageStrip | undefined, warm: KeepWarmStrip | undefined, now: number, extra: Extra = {}): Group[] {
  const out: Group[] = []
  if (!usage) return out
  const show = extra.show ?? {}
  // used / cap: the count, the slash and the cap each have their own red
  if (show.agents !== false)
  out.push({
    icon: 'agent',
    iconGap: 6,
    mod: 'agent-cap',
    spans:
      extra.used === undefined
        ? [{ text: String(usage.cap), size: 15, fill: '#E42626', tip: 'Agent Cap' }]
        : [
            // Haiku and cheap agents running, in front: "1+2/4" is one cheap, two counted, a cap of four
            ...(extra.cheap && show.cheap !== false
              ? [
                  { text: String(extra.cheap), size: 15, fill: '#FFC9C9', tip: 'Cheap Agents Running' },
                  { text: '+', size: 15, fill: '#FE5D60', tip: '+' },
                ]
              : []),
            { text: String(extra.used), size: 15, fill: '#FF9FA0', tip: 'Agents Running' },
            { text: '/', size: 15, fill: '#FE5D60', tip: '/' },
            { text: String(usage.cap), size: 15, fill: '#E42626', tip: 'Agent Cap' },
            // Codex agents run on OpenAI, apart from the cap: "cx2" after it, in teal
            ...(extra.codex && show.codex !== false ? [{ text: `cx${extra.codex}`, size: 15, fill: '#5EC8B6', gap: 8, tip: 'Codex Agents Running' }] : []),
          ],
  })
  if (usage.weekly && show.weekly !== false)
    out.push({
      icon: 'weekly',
      iconGap: 7,
      mod: 'usage-pace',
      spans: windowSpans(usage.weekly, now, { main: '#FA6A34', bar: '#982C19', soft: '#FEA75E', softBar: '#9D5E2A' }, show),
    })
  if (usage.five && show.five !== false)
    out.push({
      icon: 'five',
      iconGap: 10,
      mod: 'usage-pace',
      spans: windowSpans(usage.five, now, { main: '#6EE092', bar: '#015E37', soft: '#B8EEC6', softBar: '#609F70' }, show),
    })
  // keep-warm: `9/10 | 12:40a` while its pings run, an ice cube and `cold` once an hour has passed since the last
  // request; nothing in between (the plain `warm` state was dropped)
  if (warm && warm.coldAt !== null && show.warm !== false) {
    const isCold = now >= warm.coldAt
    if (isCold || warm.pings > 0)
      out.push({
        icon: isCold ? 'cold' : 'warm',
        iconGap: 7,
        mod: 'keep-warm',
        spans: isCold
          ? [{ text: 'cold', size: 15, fill: '#95C5ED', tip: 'Cache Cold' }]
          : [
              { text: `${warm.pings}/${warm.max}`, size: 15, fill: '#3782EA', tip: 'Cache Pings' },
              ...(warm.lastAt === null
                ? []
                : [
                    { text: '|', size: 17, fill: '#00B2F3', gap: 3, tip: '|' },
                    { text: fmtClock(warm.lastAt), size: 13, fill: '#95C5ED', gap: 3, tip: 'Last Ping' },
                  ]),
            ],
      })
  }
  // context % (was tokens this week), red once restart-clock says a restart is due; nothing before it has a reading
  if (extra.restart && extra.restart.ctx !== null && show.context !== false)
    out.push({
      icon: 'tokens',
      iconGap: 10,
      mod: 'restart-clock',
      spans: [{ text: `${extra.restart.ctx}%`, size: 15, fill: extra.restart.due ? '#FF3B3B' : '#9869F4', tip: 'Context Used' }],
    })
  return out
}

// an estimate of a text's drawn width (the SVG is an image: nothing can be measured); it only places the groups
const charW = (ch: string) => (/[ilI.,:;'|!\/ ]/.test(ch) ? 0.3 : /[mwMW%]/.test(ch) ? 0.82 : 0.55)
const spanW = (s: Span) => (s.gap ?? 0) + [...s.text].reduce((w, ch) => w + charW(ch) * s.size, 0)
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// where each group starts and how wide it is, in the row's own units
function layout(gs: Group[], width: number) {
  const widths = gs.map(g => ICONS[g.icon].w + g.iconGap + g.spans.reduce((w, s) => w + spanW(s), 0))
  // the frame spreads its groups edge to edge (space-between); squeezed, they keep at least 12 px apart
  const free = width - 2 * PAD - widths.reduce((a, b) => a + b, 0)
  const gap = gs.length > 1 ? Math.max(12, free / (gs.length - 1)) : 0
  let x = PAD
  const xs = widths.map(w => ((x += w + gap), x - w - gap))
  return { xs, widths }
}

export const STRIP_H = 24 // the frame's content height; the band's own card adds the room around it (40 stood too tall alone)
const PAD = 20

/** The strip as one SVG `width` px wide, or null when there is nothing to show yet. */
// `scale` shrinks the whole row (icons and text together): the band's card adds about 23 px of its own and takes no
// negative margin, so a strip standing alone is drawn smaller to sit level with the prompt box
export function stripSvg(
  usage: UsageStrip | undefined,
  warm: KeepWarmStrip | undefined,
  drawn: number,
  now: number,
  scale = 1,
  // the drawn height; under STRIP_H * scale the row is cropped evenly top and bottom (the icons' own empty margins go)
  height = STRIP_H * scale,
  extra: Extra = {},
): string | null {
  const gs = groups(usage, warm, now, extra)
  if (gs.length === 0) return null
  const width = drawn / scale
  const { xs, widths } = layout(gs, width)
  const parts = gs.map((g, i) => {
    const x = xs[i] ?? 0
    const icon = ICONS[g.icon]
    const y = (STRIP_H - icon.h) / 2
    const text = g.spans
      .map(s => `<tspan font-size="${s.size}" fill="${s.fill}"${s.gap ? ` dx="${s.gap}"` : ''}>${esc(s.text)}</tspan>`)
      .join('')
    const part =
      `<svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${icon.w}" height="${icon.h}" viewBox="0 0 ${icon.w} ${icon.h}" fill="none">${icon.body}</svg>` +
      `<text x="${(x + icon.w + g.iconGap).toFixed(2)}" y="${STRIP_H / 2}" dominant-baseline="central" xml:space="preserve">${text}</text>`
    return part
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${drawn}" height="${height}" viewBox="0 ${(STRIP_H - height / scale) / 2} ${width} ${height / scale}" font-family="${FONT}">${parts.join('')}</svg>`
}

// a group as plain text: `1/4` for the agent cap, otherwise the pieces apart by a space
const plain = (g: Group) => g.spans.map(sp => sp.text.trim()).join(g.icon === 'agent' ? '' : ' ')

/** The same numbers as one line of text, for a surface without SVG (the terminal) and for a screen reader. */
export function stripText(usage: UsageStrip | undefined, warm: KeepWarmStrip | undefined, now: number, extra: Extra = {}): string {
  const label: Record<keyof typeof ICONS, string> = { agent: 'agents', weekly: 'week', five: '5h', warm: 'cache', cold: 'cache', tokens: 'context' }
  return groups(usage, warm, now, extra)
    .map(g => `${label[g.icon]} ${plain(g)}`)
    .join('  ·  ')
}

/** `/ribbon`: the strip's own values as plain lines, a coloured dot per group and no titles. */
export function ribbonLines(usage: UsageStrip | undefined, warm: KeepWarmStrip | undefined, now: number, extra: Extra = {}): string[] {
  const gs = groups(usage, warm, now, extra)
  const dot: Array<[string, Array<keyof typeof ICONS>]> = [
    ['🔴', ['agent']],
    ['🟠', ['weekly']],
    ['🟢', ['five']],
    ['🔵', ['warm', 'cold']],
    ['🟣', ['tokens']],
  ]
  return dot.map(([emoji, icons]) => {
    const g = gs.find(x => icons.includes(x.icon))
    return `${emoji} ${g ? plain(g) : '—'}`
  })
}

/** Each group's hover zone in drawn px (x, width) with its card: the labels in the numbers' colours, and the mod. */
export type Zone = { key: string; x: number; w: number; tip: Array<{ text: string; fill: string }>; mod: string }
export function stripZones(usage: UsageStrip | undefined, warm: KeepWarmStrip | undefined, drawn: number, now: number, scale = 1, extra: Extra = {}): Zone[] {
  const gs = groups(usage, warm, now, extra)
  const { xs, widths } = layout(gs, drawn / scale)
  return gs.map((g, i) => ({
    key: g.icon === 'cold' ? 'warm' : g.icon,
    x: (xs[i] ?? 0) * scale,
    w: (widths[i] ?? 0) * scale,
    tip: g.spans.map(sp => ({ text: sp.tip ?? sp.text.trim(), fill: sp.fill })),
    mod: g.mod,
  }))
}

// the terminal has no SVG: one glyph per group (emoji, drawn two cells wide) and the spans as coloured text
const GLYPH: Record<keyof typeof ICONS, string> = { agent: '🤖', weekly: '📅', five: '⏳', warm: '🔥', cold: '🧊', tokens: '🧠' }
export type TermCell = { key: string; glyph: string; spans: Array<{ text: string; fill: string; tip: string }>; mod: string }

/** The strip's groups for a text surface: a glyph, each number in its own colour (a gap becomes a space), the hover labels. */
export function stripCells(usage: UsageStrip | undefined, warm: KeepWarmStrip | undefined, now: number, extra: Extra = {}): TermCell[] {
  return groups(usage, warm, now, extra).map(g => ({
    key: g.icon === 'cold' ? 'warm' : g.icon,
    glyph: GLYPH[g.icon],
    spans: g.spans.map(s => ({ text: (s.gap ? ' ' : '') + s.text, fill: s.fill, tip: s.tip ?? s.text.trim() })),
    mod: g.mod,
  }))
}
