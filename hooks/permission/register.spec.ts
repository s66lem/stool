import { expect, mock, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

tier('user')

const OPT = { options: { bypassCommand: true } }
const H = 3600_000
const APP = 'C:/Users/dev/work/app'
const KEPT = 'c:/users/dev/work/app'

// the engine beneath: a Bash call that asks, a Write that is denied by a rule, a folder, a store, a clock
function world(on: On, o: { cwd?: string; store?: Record<string, unknown> } = {}) {
  mock.clock(on, { now: 10 * H })
  const w = { store: o.store ?? ({} as Record<string, unknown>), statuses: [] as unknown[] }
  on('tool.check', (_$, e) => (e.tool === 'Write' ? { decision: 'deny', reason: 'rule' } : { decision: 'ask' }) as never)
  on('classic.PermissionRequest', () => ({}) as never)
  on('ui.status', (_$, e: any) => { w.statuses.push(e.text); return { value: undefined } as never })
  on('session.cwd', () => ({ value: o.cwd ?? APP }))
  on('store.get', (_$, e: any) => ({ value: w.store[e.key] }) as never)
  on('store.set', (_$, e: any) => { w.store[e.key] = e.value; return { value: undefined } as never })
  return w
}
const run = ($: any, args: string) => $.command.run({ command: 'stoolpermission', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const check = ($: any, tool: string) => $.tool.check({ tool, input: {} })
const ask = ($: any, mode: string, cwd = APP) => $.classic.PermissionRequest({ hook_event_name: 'PermissionRequest', session_id: 's', transcript_path: '', cwd, permission_mode: mode, tool_name: 'Bash', tool_input: {} })

test('bypass turns asks into allows, keeps denies, and off puts it back', OPT, async ($, on) => {
  world(on)
  expect((await check($, 'Bash')).decision).toBe('ask')
  expect((await run($, 'bypass')).text).toContain('bypassPermissions')
  expect((await check($, 'Bash')).decision).toBe('allow')
  expect((await check($, 'Write')).decision).toBe('deny')
  expect((await run($, 'off')).text).toContain('No permission mode set')
  expect((await check($, 'Bash')).decision).toBe('ask')
  expect((await run($, 'maybe')).text).toContain('Usage')
})

test('--persist holds a folder to a mode: a plain off is refused, off --persist ends it', OPT, async ($, on) => {
  const w = world(on, { store: {} })
  expect((await run($, 'bypassPermissions --persist')).text).toContain(`Held for ${KEPT}`)
  expect(w.store['permission-folders']).toEqual({ [KEPT]: 'bypassPermissions' })
  expect((await run($, 'off')).text).toContain('would be put back')
  expect((await check($, 'Bash')).decision).toBe('allow')
  expect((await run($, 'off --persist')).text).toContain('No longer held')
  expect(w.store['permission-folders']).toEqual({})
  expect((await check($, 'Bash')).decision).toBe('ask')
})

test('a session below a held folder is held to its mode; one elsewhere is not; the 2.8 list still means bypass', OPT, async ($, on) => {
  world(on, { cwd: `${APP}/sub`, store: { 'bypass-folders': [KEPT] } })
  expect((await check($, 'Bash')).decision).toBe('allow')
  expect((await check($, 'Write')).decision).toBe('deny')
})

test('a folder outside the held ones asks as before', OPT, async ($, on) => {
  world(on, { cwd: 'C:/Users/dev/other', store: { 'permission-folders': { [KEPT]: 'bypassPermissions' } } })
  expect((await check($, 'Bash')).decision).toBe('ask')
})

test('a real mode is set when a prompt comes up in a session that is in another one', OPT, async ($, on) => {
  world(on, { store: { 'permission-folders': { [KEPT]: 'auto' } } })
  expect((await check($, 'Bash')).decision).toBe('ask') // auto is the engine's own, not an override
  const r = await ask($, 'default')
  expect(r.decision).toEqual({ behavior: 'allow', updatedPermissions: [{ type: 'setMode', mode: 'auto', destination: 'session' }] })
  expect((await ask($, 'auto')).decision).toBe(undefined) // already there
  expect((await ask($, 'default', 'C:/Users/dev/other')).decision).toBe(undefined) // not held
})

test('acceptEdits for this session only: set at the next prompt, no folder written', OPT, async ($, on) => {
  const w = world(on)
  expect((await run($, 'accept')).text).toContain('next permission prompt')
  expect(w.store['permission-folders']).toBe(undefined)
  expect((await ask($, 'default')).decision.updatedPermissions[0].mode).toBe('acceptEdits')
  await run($, 'off')
})

test('without the bypassCommand option nothing is added', async ($, on) => {
  world(on)
  expect((await check($, 'Bash')).decision).toBe('ask')
})
