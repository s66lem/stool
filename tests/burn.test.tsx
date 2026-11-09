import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { at, chart, currentWeek, downsample, project, summary } from '../hooks/burn-pace/burn'

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

test('pace is the last 24 h; it ends under 100% when slow', () => {
  // flat 28% until 24 h ago, then +12 pts over the last 24 h: 40% now, +36 more in 72 h = 76%
  const w = currentWeek(log(h => (h <= 72 ? 28 : 28 + (h - 72) / 2)))!
  const p = project(w, NOW)
  expect(p.now).toBe(40)
  expect(r6(p.per24h)).toBe(12)
  expect(r6(p.atReset)).toBe(76)
  expect(p.outAt).toBe(null)
  expect(summary(p)).toBe('now 40% · last 24h +12.0 pts · projected 76% at reset')
  expect(chart(w, p, NOW, 'UTC')).toContain('ends at 76%')
})

test('a fast pace crosses 100% before the reset, and says when', () => {
  // +24 pts over the last 24 h from 40%: 64% now, the other 36 pts take 36 h
  const w = currentWeek(log(h => (h <= 72 ? 40 : 40 + (h - 72))))!
  const p = project(w, NOW)
  expect(r6(p.per24h)).toBe(24)
  expect(r6(p.atReset)).toBe(136)
  expect(r6(p.outAt!)).toBe(NOW + 36 * H)
  // NOW = Mon 11-09 19:00 UTC; +36 h = Wed 11-11 07:00 UTC
  expect(at(p.outAt!, 'UTC')).toBe('Wed 7am')
  expect(chart(w, p, NOW, 'UTC')).toContain('out Wed 7am')
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
const LINE = 'now 64% · last 24h +24.0 pts · projected 136% at reset'
const ON = { options: { usageLog: true } }

// a fast week's log at NOW, and what the settings window reads besides
function seed(on: On) {
  const text = log(h => (h <= 72 ? 40 : 40 + (h - 72)))
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
    }
    expect((await ui.find({ type: 'Text', text: /projected 136%/ }))?.text).toBe(LINE)
    await ui.press({ key: 'burn' })
    expect(await ui.find({ type: 'Text', text: /projected 136%/ })).toBe(undefined)
    await ui.unmount()
  }
})

test('/burn opens a pane with the same chart', ON, async ($, on) => {
  seed(on)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  expect((await $.command.run({ command: 'burn' } as never)).text).toBe('Weekly burn opened.')
  const ui = await $.ui.mount({ ...pane('burn-pace', 'Weekly burn'), surface: 'desktop' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
  expect((await ui.find({ type: 'Text', text: /projected 136%/ }))?.text).toBe(LINE)
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
