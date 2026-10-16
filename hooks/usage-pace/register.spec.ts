import { expect, mock, test } from 'claude-code/testing'

import { cap, line, runsOut, when } from './register'

const H = 3600_000
const reset5 = Date.parse('2026-10-10T11:40:00Z')
const five = (percentUsed: number) => ({ kind: 'five_hour', percentUsed, resetsAt: '2026-10-10T11:40:00Z' })
// a weekly window that resets hoursLeft after now
const week = (percentUsed: number, now: number, hoursLeft: number) => ({
  kind: 'seven_day',
  percentUsed,
  resetsAt: new Date(now + hoursLeft * H).toISOString(),
})
const minutesIn = (m: number) => reset5 - 5 * H + m * 60_000

test('warns when the pace hits the limit before the reset', () => {
  // 50% after 1h: the other 50% takes 1h more, 3h before the reset
  expect(line([five(50)], minutesIn(60))).toBe(
    '5h limit: 50% used. At this pace you hit it in ~1h00m, 3h00m before it resets.',
  )
})

test('quiet when the window lasts, too early to tell, or no reading', () => {
  expect(line([five(20)], minutesIn(150))).toBe(undefined)
  expect(line([five(30)], minutesIn(10))).toBe(undefined)
  expect(line([], reset5)).toBe(undefined)
})

test('the agent cap follows the 5-hour and weekly pace', () => {
  const now = minutesIn(60)
  expect(cap([], now).cap).toBe(6) // no reading
  expect(cap([five(15)], now).cap).toBe(6) // 75% at reset
  expect(cap([five(25)], now).cap).toBe(4) // 125%
  expect(cap([five(40)], now).cap).toBe(2) // 200%
  expect(cap([five(96)], minutesIn(280)).cap).toBe(0) // nearly out
  expect(cap([five(15), week(50, now, 100)], now).cap).toBe(4) // weekly on pace for 124%
  expect(cap([five(40), week(60, now, 12)], now).cap).toBe(8) // weekly resets in 12h on pace for 65%
  expect(cap([five(96), week(60, now, 12)], minutesIn(280)).cap).toBe(0) // the stop wins over all out
})

test('the 5-hour pace follows the last 30 minutes once there are readings', () => {
  const now = minutesIn(120)
  const half = now - 30 * 60_000
  // 30% two hours in is 75% on average; 15 points in the last half hour is 30 + 6 x 15 = 120%
  expect(cap([five(30)], now).cap).toBe(6)
  expect(cap([five(30)], now, [{ t: half, used: 15 }]).cap).toBe(4)
  // 40% one hour in is 200% on average; 2 points in the last half hour is 40 + 8 x 2 = 56%
  const early = minutesIn(60)
  expect(cap([five(40)], early).cap).toBe(2)
  expect(cap([five(40)], early, [{ t: early - 30 * 60_000, used: 38 }]).cap).toBe(6)
  expect(line([five(40)], early, [{ t: early - 30 * 60_000, used: 38 }])).toBe(undefined)
})

test('times read as local clock times and the run-out is set against the reset', () => {
  const now = Date.parse('2026-10-12T16:00:00Z') // a Monday
  expect(when(now + 2 * H, now, 'UTC')).toBe('6pm')
  expect(when(Date.parse('2026-10-15T10:00:00Z'), now, 'UTC')).toBe('Thursday 10am')
  expect(when(Date.parse('2026-10-13T21:36:00Z'), now, 'UTC')).toBe('Tuesday 9:36pm')
  const p = { used: 88, projected: 145, leftMs: 66 * H, toLimitMs: 29.6 * H }
  expect(runsOut(p, now, 'UTC')).toBe('out Tuesday 9:36pm (in 1d5h36m), 1d12h24m before its reset')
  expect(runsOut({ ...p, toLimitMs: 70 * H }, now, 'UTC')).toBe('would run out 4h00m after its reset')
})

test('the meter log gets a line each time a reading moves, when usageLog is on', { options: { usageLog: true } }, async ($, on) => {
  mock.clock(on, { now: 5 * H })
  const w = { file: '', n: 0 }
  on('fs.read', () => { if (!w.file) throw new Error('ENOENT'); return { value: w.file } })
  on('fs.write', (_$, e) => { w.file = e.text; return { value: undefined } })
  on('env.get', () => ({ value: 'C:/Users/dev' }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }) as never)
  on('state.set', () => ({ value: undefined }) as never)
  on('store.get', () => ({ value: undefined }) as never)
  on('store.set', () => ({ value: undefined }) as never)
  const measure = (five: number, wk: number) => $.session.measure({ context: { window: 1, percent: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-10T11:40:00Z' }, { kind: 'seven_day', percentUsed: wk, resetsAt: '2026-10-15T10:00:00Z' }], changed: ['rateLimits'] } as never)
  await measure(12, 22)
  await measure(12, 22) // unchanged: no second line
  await measure(13, 22)
  const lines = w.file.trim().split('\n').map(l => JSON.parse(l))
  expect(lines.length).toBe(2)
  expect(lines[0]).toEqual({ t: 5 * H, five: 12, week: 22, weekResetsAt: '2026-10-15T10:00:00Z' })
  expect(lines[1].five).toBe(13)
})
