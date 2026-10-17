import { expect, mock, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

tier('user')

const OPT = { options: { bypassCommand: true } }
const H = 3600_000

// the engine beneath: a Bash call that asks, a Write that is denied by a rule, a folder, a store, a clock
function world(on: On, o: { cwd?: string; kept?: string[] } = {}) {
  const clock = mock.clock(on, { now: 10 * H })
  const w = { kept: o.kept as string[] | undefined, clock }
  on('tool.check', (_$, e) => (e.tool === 'Write' ? { decision: 'deny', reason: 'rule' } : { decision: 'ask' }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.cwd', () => ({ value: o.cwd ?? 'C:/Users/dev/work/app' }))
  on('store.get', () => ({ value: w.kept }) as never)
  on('store.set', (_$, e: any) => { w.kept = e.value; return { value: undefined } as never })
  return w
}
const run = ($: any, args: string) => $.command.run({ command: 'bypass', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const check = ($: any, tool: string) => $.tool.check({ tool, input: {} })

test('/bypass on turns asks into allows, keeps denies, and off puts it back', OPT, async ($, on) => {
  world(on)
  expect((await check($, 'Bash')).decision).toBe('ask')
  expect((await run($, 'on')).text).toContain('Bypass is on')
  expect((await check($, 'Bash')).decision).toBe('allow')
  expect((await check($, 'Write')).decision).toBe('deny')
  expect((await run($, 'off')).text).toBe('Bypass is off.')
  expect((await check($, 'Bash')).decision).toBe('ask')
  expect((await run($, 'maybe')).text).toContain('Usage')
})

test('--persist keeps a folder bypassed: a plain off is refused, off --persist ends it', OPT, async ($, on) => {
  const w = world(on, { kept: [] })
  expect((await run($, '--persist')).text).toContain('Kept for c:/users/dev/work/app')
  expect(w.kept).toEqual(['c:/users/dev/work/app'])
  expect((await run($, 'off')).text).toContain('would be turned back on')
  expect((await check($, 'Bash')).decision).toBe('allow')
  expect((await run($, 'off --persist')).text).toContain('No longer kept')
  expect(w.kept).toEqual([])
  expect((await check($, 'Bash')).decision).toBe('ask')
})

test('a session in a kept folder (or below it) is bypassed without typing anything, one elsewhere is not', OPT, async ($, on) => {
  world(on, { cwd: 'C:/Users/dev/work/app/sub', kept: ['c:/users/dev/work/app'] })
  expect((await check($, 'Bash')).decision).toBe('allow')
  expect((await check($, 'Write')).decision).toBe('deny')
})

test('a folder outside the kept ones asks as before', OPT, async ($, on) => {
  world(on, { cwd: 'C:/Users/dev/other', kept: ['c:/users/dev/work/app'] })
  expect((await check($, 'Bash')).decision).toBe('ask')
})

test('without the bypassCommand option nothing is added', async ($, on) => {
  world(on)
  expect((await check($, 'Bash')).decision).toBe('ask')
})
