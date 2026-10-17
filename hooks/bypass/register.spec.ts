import { expect, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

tier('user')

const OPT = { options: { bypassCommand: true } }

// the engine beneath: a Bash call that asks, a Write that is denied by a rule
function world(on: On) {
  on('tool.check', (_$, e) => (e.tool === 'Write' ? { decision: 'deny', reason: 'rule' } : { decision: 'ask' }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
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

test('without the bypassCommand option nothing is added', async ($, on) => {
  world(on)
  expect((await check($, 'Bash')).decision).toBe('ask')
})
