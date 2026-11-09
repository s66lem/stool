import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { at, BOX, chart, currentWeek, SCALE, downsample, hourly, labelBox, project, readouts, span, summary } from '../hooks/burn-pace/burn'

const H = 3600_000
const r6 = (x: number) => Math.round(x * 1e6) / 1e6
const RESET = '2026-11-12T19:00:00.000Z'
const reset = Date.parse(RESET)
const start = reset - 168 * H
const NOW = start + 96 * H // 4 days in, 3 days (72 h) left
// one log line per hour of `pct(h)` over the first 96 h, plus a line of last week's window that must be ignored
const log = (pct: (h: number) => number) =>
  [JSON.stringify({ t: start - 10 * H, five: 1, week: 99, weekResetsAt: new Date(start).toISOString() })]
    .concat(Array.from({ length: 97 }, (_, h) => JSON.stringify({ t: start + h * H, five: 5, week: pct(h), weekResetsAt: RESET })))
    .join('\n') + '\nnot json\n'

test('reads only the current week', () => {
  const w = currentWeek(log(h => h / 4))!
  expect(w.start).toBe(start)
  expect(w.reset).toBe(reset)
  expect(w.points).toHaveLength(97)
  expect(w.points[0]).toEqual({ t: start, week: 0 })
  expect(currentWeek('')).toBe(undefined)
})

const LINE1 = 'used 64% · pace 1.0 pts/hr (24 h) · avg 0.7'
const LINE2 = 'can spend 0.5 pts/hr · runs out Wed 7am'
const slow = (h: number) => (h <= 72 ? 28 : 28 + (h - 72) / 2) // 40% now, +12 pts over the last 24 h
const fast = (h: number) => (h <= 72 ? 40 : 40 + (h - 72)) // 64% now, +24 pts over the last 24 h
// 40% to h72, +0.5/h to h90 (49%), then +2/h: 61% now; the last 6 h run four times the 24 h pace's second half
const late = (h: number) => (h <= 72 ? 40 : h <= 90 ? 40 + (h - 72) * 0.5 : 49 + (h - 90) * 2)
const hits = (svg: string) => svg.split('<g class="h">').length - 1

test('pace in pts/hr over the last 24 h, the week average, the can-spend rate; slow ends under 100%', () => {
  const w = currentWeek(log(slow))!
  const p = project(w, NOW)
  expect(p.now).toBe(40)
  expect(p.window).toBe(24)
  expect(r6(p.pace.rate)).toBe(0.5)
  expect(r6(p.avg.rate)).toBe(r6(40 / 96))
  expect(r6(p.canSpend)).toBe(r6(60 / 72))
  expect(r6(p.pace.atReset)).toBe(76)
  expect(p.pace.outAt).toBe(null)
  expect(readouts(p, 'UTC')).toEqual([
    'used 40% · pace 0.5 pts/hr (24 h) · avg 0.4',
    'can spend 0.8 pts/hr · lasts, ends ~76%',
  ])
  expect(chart(w, p, NOW, 'UTC')).toContain('ends ~76%')
})

test('a fast pace crosses 100% before the reset, and says when; both projections drawn', () => {
  const w = currentWeek(log(fast))!
  const p = project(w, NOW)
  expect(r6(p.pace.rate)).toBe(1)
  expect(r6(p.pace.atReset)).toBe(136)
  expect(r6(p.pace.outAt!)).toBe(NOW + 36 * H)
  expect(r6(p.avg.outAt!)).toBe(NOW + 54 * H) // 36 pts left at 64/96 pts/hr
  expect(r6(p.canSpend)).toBe(0.5)
  // NOW = Mon 11-09 19:00 UTC; +36 h = Wed 11-11 07:00 UTC
  expect(at(p.pace.outAt!, 'UTC')).toBe('Wed 7am')
  expect(summary(p, 'UTC')).toBe(LINE1 + ' · ' + LINE2)
  const svg = chart(w, p, NOW, 'UTC')
  expect(svg).toContain('out Wed 7am')
  expect(svg).toContain('week avg</text>')
  expect(svg).toContain('last 24 h pace</text>')
  expect(svg).toContain('can spend 0.5/h')
})

test('the pace window picks which pace the readout and projection use', () => {
  const w = currentWeek(log(late))!
  expect(r6(project(w, NOW, 24).pace.rate)).toBe(r6(21 / 24))
  expect(r6(project(w, NOW, 1).pace.rate)).toBe(2)
  const p = project(w, NOW, 6)
  expect(r6(p.pace.rate)).toBe(2)
  expect(r6(p.pace.outAt!)).toBe(NOW + 19.5 * H) // 39 pts at 2/h
  expect(readouts(p, 'UTC')[0]).toBe('used 61% · pace 2.0 pts/hr (6 h) · avg 0.6')
  expect(readouts(p, 'UTC')[1]).toBe('can spend 0.5 pts/hr · runs out Tue 2:30pm')
  expect(chart(w, p, NOW, 'UTC')).toContain('last 6 h pace</text>')
})

test('hourly bars: one per hour up to now, the points gained that hour, a hidden hover readout per hour', () => {
  const w = currentWeek(log(fast))!
  const hs = hourly(w, NOW)
  expect(hs).toHaveLength(96)
  expect(hs[0]).toEqual({ t: start, pct: 40, gain: 0 })
  expect(hs.filter(q => q.gain === 1).map(q => (q.t - start) / H)).toEqual(Array.from({ length: 24 }, (_, i) => 72 + i))
  expect(hs[95]).toEqual({ t: NOW - H, pct: 64, gain: 1 })
  const svg = chart(w, project(w, NOW), NOW, 'UTC')
  expect(hits(svg)).toBe(168)
  expect(svg).toContain('Mon 6pm · 64% · +1.0/h</text>')
  expect(svg).toContain('Mon 7pm · ~65% at pace</text>')
  expect(svg).toContain('.h:hover .r{visibility:visible}')
})

// each hover group: its hit rect (x, width) and its label box (x, width)
const groups = (svg: string) =>
  svg.split('<g class="h">').slice(1).map(s => {
    const n = [...s.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map(m => [Number(m[1]), Number(m[2])] as const)
    return { hit: n[0]!, label: n[1]! }
  })

test('narrow-pane svg: a fixed drawn size (the frame takes its height from it), no <title>, no dimming, one readout per hour', () => {
  const w = currentWeek(log(fast))!
  for (const range of ['week', '48h'] as const) {
    const svg = chart(w, project(w, NOW), NOW, 'UTC', range)
    const root = svg.slice(0, svg.indexOf('>') + 1)
    expect(root).toContain(`viewBox="0 0 ${BOX.W} ${BOX.Ht}"`)
    expect(root).toContain(`width="${Math.round(BOX.W * SCALE)}"`)
    expect(root).toContain(`height="${Math.round(BOX.Ht * SCALE)}"`)
    expect(root).toContain('font-size="12"')
    expect(svg).not.toContain('<title')
    expect(svg).not.toContain('opacity:')
    const gs = groups(svg)
    expect(gs).toHaveLength(range === 'week' ? 168 : 48)
    expect(svg.split('<g class="r">').length - 1).toBe(gs.length)
    // hit rects tile the plot: adjacent, never overlapping, inside the plot
    expect(gs[0]!.hit[0]).toBe(BOX.L)
    for (let i = 1; i < gs.length; i++) expect(Math.abs(gs[i]!.hit[0] - (gs[i - 1]!.hit[0] + gs[i - 1]!.hit[1]))).toBeLessThan(0.15)
    const last = gs[gs.length - 1]!.hit
    expect(Math.abs(last[0] + last[1] - (BOX.W - BOX.R))).toBeLessThan(0.15)
    // every label stays inside the viewBox, the last hours' flipped left of the guide
    for (const g of gs) {
      expect(g.label[0]).toBeGreaterThanOrEqual(0)
      expect(g.label[0] + g.label[1]).toBeLessThanOrEqual(BOX.W)
    }
    const lastGuide = last[0] + last[1] / 2
    expect(gs[gs.length - 1]!.label[0] + gs[gs.length - 1]!.label[1]).toBeLessThan(lastGuide)
    expect(gs[0]!.label[0]).toBeGreaterThan(gs[0]!.hit[0])
  }
  // the hovered hour's dot sits on the actual line: Mon 6pm (h 95) at 64%
  expect(chart(w, project(w, NOW), NOW, 'UTC')).toMatch(/<circle cx="[\d.]+" cy="[\d.]+" r="3.5" fill="#5fbf9f" stroke="white"/)
})

test('label box: right of the guide, flipped left near the right edge, clamped inside the viewBox', () => {
  const text = 'Wed 12pm · ~100% at pace'
  const a = labelBox(BOX.L + 2, text)
  expect(a.x).toBe(Math.round(BOX.L + 8))
  const b = labelBox(BOX.W - BOX.R - 1, text)
  expect(b.x + b.w).toBeLessThan(BOX.W - BOX.R - 1)
  expect(b.x).toBeGreaterThanOrEqual(0)
  const huge = labelBox(BOX.W / 2, 'x'.repeat(80))
  expect(huge.x).toBeGreaterThanOrEqual(0)
})

test('range: the week, or 48 h (36 h back, 12 h ahead) kept inside the week', () => {
  const w = currentWeek(log(fast))!
  expect(span(w, NOW, 'week')).toEqual([start, reset])
  expect(span(w, NOW, '48h')).toEqual([NOW - 36 * H, NOW + 12 * H])
  expect(span(w, start + 2 * H, '48h')).toEqual([start, start + 48 * H])
  expect(span(w, reset - H, '48h')).toEqual([reset - 48 * H, reset])
  const svg = chart(w, project(w, NOW), NOW, 'UTC', '48h')
  expect(hits(svg)).toBe(48)
  expect(svg).toContain('Mon 6pm · 64% · +1.0/h</text>')
})

test('a dense week (a reading a minute) stays under the Svg cap', () => {
  const rows = Array.from({ length: 168 * 60 }, (_, m) => JSON.stringify({ t: start + m * 60_000, week: 100 * (m / (168 * 60)) ** 1.3, weekResetsAt: RESET }))
  const w = currentWeek(rows.join('\n'))!
  const now = reset - 60_000
  for (const range of ['week', '48h'] as const)
    for (const win of [1, 6, 24] as const) expect(chart(w, project(w, now, win), now, 'UTC', range).length).toBeLessThan(131072)
})

test('downsamples to at most 300 points, keeping the last', () => {
  const xs = Array.from({ length: 1000 }, (_, i) => i)
  const d = downsample(xs)
  expect(d.length).toBeLessThanOrEqual(300)
  expect(d[d.length - 1]).toBe(999)
  expect(downsample([1, 2, 3])).toEqual([1, 2, 3])
})

const pane = (requestId: string, title: string) =>
  ({
    plugin: 'stool',
    component: 'Pane',
    requestId,
    props: { title, isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 34 }, view: {} },
  }) as const
const SETTINGS = pane('settings', 'Stool settings')
const ON = { options: { usageLog: true } }

// a fast week's log at NOW, and what the settings window reads besides
function seed(on: On) {
  const text = log(fast)
  on('env.get', () => ({ value: 'C:/Users/me' }))
  on('fs.read', () => ({ value: text }))
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000 }, rateLimits: [] } }) as never)
}

test('the settings window shows the burn chart on a press: one svg on desktop and mobile, a text line on the terminal', ON, async ($, on) => {
  seed(on)
  for (const surface of ['desktop', 'mobile', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...SETTINGS, surface })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
    await ui.press({ key: 'burn' })
    const svgs = await ui.findAll({ type: 'Svg' })
    if (surface === 'terminal') expect(svgs).toHaveLength(0)
    else {
      expect(svgs).toHaveLength(1)
      const src = String(svgs[0]?.props.source)
      expect(src.startsWith('<svg')).toBe(true)
      expect(src).toContain('<polyline')
      expect(src).toContain('out ')
      expect(svgs[0]?.props.isInteractive).toBe(true)
      expect(await ui.find({ type: 'Button', key: 'burn-window-6' })).toBeTruthy()
    }
    expect((await ui.find({ type: 'Text', text: /^used 64%/ }))?.text).toBe(LINE1)
    expect((await ui.find({ type: 'Text', text: /can spend/ }))?.text).toBe(LINE2.replace('Wed 7am', at(NOW + 36 * H))) // local time
    await ui.press({ key: 'burn' })
    expect(await ui.find({ type: 'Text', text: /^used 64%/ })).toBe(undefined)
    await ui.unmount()
  }
})

test('/burn opens a pane with the same chart', ON, async ($, on) => {
  seed(on)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  expect((await $.command.run({ command: 'burn' } as never)).text).toBe('Weekly burn opened.')
  const ui = await $.ui.mount({ ...pane('burn-pace', 'Weekly burn'), surface: 'desktop' })
  const svg = async () => String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
  expect((await ui.find({ type: 'Text', text: /^used 64%/ }))?.text).toBe(LINE1)
  expect(hits(await svg())).toBe(168)
  // the buttons switch the pace window (readout and projection) and the range, and the pane redraws
  await ui.press({ key: 'burn-window-1' })
  expect((await ui.find({ type: 'Text', text: /^used 64%/ }))?.text).toBe('used 64% · pace 1.0 pts/hr (1 h) · avg 0.7')
  expect(await svg()).toContain('last 1 h pace</text>')
  await ui.press({ key: 'burn-range-48h' })
  expect(hits(await svg())).toBe(48)
  await ui.press({ key: 'burn-range-week' })
  await ui.press({ key: 'burn-window-24' })
  expect(hits(await svg())).toBe(168)
  expect((await ui.find({ type: 'Text', text: /^used 64%/ }))?.text).toBe(LINE1)
  await ui.unmount()
})

test('with usageLog off, /burn and the settings button say so in one line', { options: { usageLog: false } }, async ($, on) => {
  seed(on)
  expect((await $.command.run({ command: 'burn' } as never)).text).toMatch(/needs Log meter readings \(usageLog\)/)
  const ui = await $.ui.mount({ ...SETTINGS, surface: 'desktop' })
  await ui.press({ key: 'burn' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /Weekly burn needs Log meter readings/ })).toBeTruthy()
  await ui.unmount()
})
