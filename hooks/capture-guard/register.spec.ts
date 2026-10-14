import { expect, test, tier } from 'claude-code/testing'

import { inScope } from '../config'
import { Breaker, HOLD_MS, parseStrip } from './register'

tier('user')

test('breaker trips after 2 failures in a row per agent, a success resets, it expires', () => {
  const b = new Breaker()
  b.fail('a', 0)
  expect(b.tripped('a', 1)).toBe(false)
  b.fail('a', 2)
  expect(b.tripped('a', 3)).toBe(true)
  expect(b.tripped('b', 3)).toBe(false)
  b.ok('a')
  expect(b.tripped('a', 4)).toBe(false)
  b.fail('a', 5); b.fail('a', 6)
  expect(b.tripped('a', 6 + HOLD_MS + 1)).toBe(false)
})

test('strip parse and scope', () => {
  expect(parseStrip('5872000 3\r\n')).toEqual({ ramFreeGB: 5.6, appWindows: 3 })
  expect(parseStrip('junk')).toBeUndefined()
  expect(inScope('C:\\Users\\dev\\work\\app', ['C:/Users/dev/work'])).toBe(true)
  expect(inScope('C:/Users/dev/elsewhere', ['C:/Users/dev/work'])).toBe(false)
})
