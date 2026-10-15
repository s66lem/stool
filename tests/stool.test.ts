// the bundled plugin as one: every mod's session.start still runs beside the others, and a hook from another mod still answers
import { expect, mock, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = 'C:/Users/dev/work/app'
const OPT = { options: { projectRoots: ['C:/Users/dev/work'], leadGuard: true } }

test('all five tools register, and lead-guard still denies beside the rest', OPT, async ($, on) => {
  mock.clock(on, { now: 10 * 3600_000 })
  const tools: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => { tools.push(e.name); return { value: { tool: e.name } } })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 's1' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000 }, rateLimits: [] } }))
  for (const n of ['get', 'set', 'delete']) on(('store.' + n) as never, () => ({ value: undefined }) as never)
  on('store.keys', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT })
  for (const t of ['plan_progress', 'restart_session', 'reload_plugins', 'keep_warm']) expect(tools).toContain(t)
  expect((await $.tool.call({ tool: 'Bash', command: 'git add -A' })).deny).toContain('lead-guard')
})

test('opt-in parts are off by default: nothing is denied', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT })
  expect((await $.tool.call({ tool: 'Bash', command: 'git add -A' })).deny).toBeUndefined()
})

test('/ribbon answers its five lines as the command text, also with no usage state yet', async ($, on) => {
  mock.clock(on, { now: 10 * 3600_000 })
  on('state.get', () => ({ value: { value: undefined, version: 0 } }) as never)
  on('fs.read', () => { throw new Error('no slot file') })
  on('env.get', () => ({ value: undefined }) as never)
  const { text } = await $.command.run({ command: 'ribbon' })
  expect(text?.split('\n')).toEqual(['🔴 —', '🟠 —', '🟢 —', '🔵 —', '🟣 —'])
})
