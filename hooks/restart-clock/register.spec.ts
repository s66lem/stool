import { expect, mock, test, tier } from 'claude-code/testing'

import { inScope } from '../config'
import { CTX_AT, lintHandoff } from './register'

tier('user')

const OPT = { options: { projectRoots: ['C:/Users/dev/work'], restartPublishCounter: true, restartPublishPattern: String.raw`\bpublish\.mjs\s+test\b`, restartHandoffLint: true } }

const NOW = Date.UTC(2026, 9, 14, 2, 10)
const ROOT = 'C:/Users/dev/work/app'

test('lintHandoff: one heading, a time that is now', () => {
  const ok = '## RESUME HERE (rewritten 2026-10-14 02:05Z by `date -u`)\nx\n## Before\n'
  expect(lintHandoff(ok, NOW)).toEqual([])
  expect(lintHandoff(ok + '## RESUME HERE (2026-10-14 02:05Z)\n', NOW).length).toBe(1)
  expect(lintHandoff(ok.replace('02:05', '12:24'), NOW)[0]).toContain('not now')
  expect(lintHandoff('## RESUME HERE (rewritten today)\n', NOW)[0]).toContain('no "YYYY')
})

test('scope', () => {
  expect(inScope(ROOT, ['C:/Users/dev/work'])).toBe(true)
  expect(inScope('C:/Users/dev/elsewhere', ['C:/Users/dev/work'])).toBe(false)
})

test('the 3rd publish and 65% context add one note to the next tool result; a RESUME HERE rewrite resets the count', OPT, async ($, on) => {
  const toasts: string[] = []
  const states: unknown[] = []
  let percent = 40
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, percent }, rateLimits: [] } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('state.set', (_$, e) => {
    states.push(e.value)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT })
  const pub = () => $.tool.call({ tool: 'Bash', command: 'node tools/publish.mjs test saved' })
  const notes = (r: { context?: readonly string[] }) => (r.context ?? []).filter(c => c.includes('restart due'))
  expect(notes(await pub()).length).toBe(0)
  expect(notes(await pub()).length).toBe(0)
  await $.tool.call({ tool: 'Edit', file_path: 'C:/x/docs/HANDOFF.md', old_string: '## RESUME HERE (a)', new_string: '## RESUME HERE (b)' })
  await pub()
  await pub()
  const third = notes(await pub())
  expect(third.length).toBe(1)
  expect(third[0]).toContain('3 publishes')
  expect(notes(await pub()).length).toBe(0)
  percent = CTX_AT
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((states.at(-1) as { ctx: number }).ctx).toBe(CTX_AT)
  expect(toasts.length).toBe(0)
})

test('a HANDOFF.md edit that leaves two headings is warned about', OPT, async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: 'ok' }))
  mock.clock(on, { now: NOW })
  on('fs.read', () => ({ value: '## RESUME HERE (2026-10-14 02:05Z)\n## RESUME HERE (2026-10-14 02:06Z)\n' }))
  on('ui.toast', () => ({ value: undefined }))
  on('state.set', () => ({ value: undefined }))
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT })
  const r = await $.tool.call({ tool: 'Edit', file_path: 'C:/x/docs/HANDOFF.md', old_string: 'a', new_string: 'b' })
  expect(String(r.context)).toContain('restart-clock warning')
})
