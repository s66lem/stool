import { expect, mock, test, tier } from 'claude-code/testing'

import { TIERS_DEFAULT, dueTiers, parseTiers, tierLine } from '../config'
import { withReviews } from './register'

tier('user')

test('restart_session: clear, then /model, then the prompt; no model means no /model; a bad name is refused', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const seen: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.run', (_$, e) => { seen.push(`${e.command} ${e.args}`.trim()); return { text: '' } })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.submit', (_$, e) => { seen.push(`prompt ${e.text}`); return { text: e.text } })
  await $.session.start({ surface: null, isInteractive: false, cwd: 'C:/x' })
  for (const [input, want] of [
    [{ prompt: 'go', model: 'sonnet' }, ['clear', 'model sonnet', 'prompt go']],
    [{ prompt: 'go' }, ['clear', 'prompt go']],
  ] as const) {
    seen.length = 0
    const r = await $.tool.call({ tool: 'mcp__stool__restart_session', ...input })
    expect(r.result).toContain('Restart queued')
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.advance(2000)
    expect(seen).toEqual(want)
  }
  const bad = await $.tool.call({ tool: 'mcp__stool__restart_session', prompt: 'go', model: 'a b;c' })
  expect(bad.result).toContain('model was not changed')
})

test('reload_plugins: rewrites hooks/reload-stamp.ts (the watcher reloads the module); no config.set, no /reload-plugins', async ($, on) => {
  const seen: unknown[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.run', (_$, e: any) => { seen.push(['command', e.command]); return { text: '' } as never })
  on('config.set', (_$, e: any) => { seen.push(['config', e.key]); return { value: e.value } as never })
  on('process.run', (_$, e: any) => { seen.push(e.argv); return { value: { exitCode: 0, stdout: '', stderr: '' } } as never })
  await $.session.start({ surface: null, isInteractive: false, cwd: 'C:/x' })
  const r = await $.tool.call({ tool: 'mcp__stool__reload_plugins' })
  expect(r.result).toContain('Reload queued')
  expect(seen.length).toBe(1)
  const argv = seen[0] as string[]
  expect(argv[0]).toBe('node')
  expect(argv[2]).toContain('RELOAD_STAMP')
  expect(argv[3]).toMatch(/hooks[\/]reload-stamp\.ts$/)
})

test('review tiers: parsed from the option lines, due on multiples of their interval, 0 = off', () => {
  expect(parseTiers(undefined).map(tierLine)).toEqual(TIERS_DEFAULT)
  const t = parseTiers(['goal: why-behind every 2', 'deep every 0', 'junk', 'Deep EVERY 3'])
  expect(t.map(tierLine)).toEqual(['goal: why-behind every 2', 'deep every 0', 'deep every 3'])
  expect(dueTiers(t, 6).map(x => x.name)).toEqual(['goal', 'deep'])
  expect(dueTiers(t, 5)).toEqual([])
  expect(dueTiers(t, 0)).toEqual([])
  const d = parseTiers(undefined)
  expect([1, 4, 5, 9, 10].map(n => dueTiers(d, n).map(x => x.type).join('+'))).toEqual(['', '', 'why-behind', '', 'why-behind+deep'])
  expect(withReviews('go', d, 3).text).toBe('go')
  const ten = withReviews('go', d, 10).text
  expect(ten).toContain('Why-behind review')
  expect(ten).toContain('Deep review')
  expect(ten).toContain('Lessons pass')
  expect(ten.endsWith('Then: go')).toBe(true)
})

test('restart_session reads docs/restart_count.txt and puts the due review in front of the resume prompt', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  let count = '5\n'
  const reads: string[] = []
  const seen: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:' + String.fromCharCode(92) + 'x' }) as never)
  on('fs.read', (_$, e: any) => { reads.push(e.path); return { value: count } as never })
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.run', () => ({ text: '' }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.submit', (_$, e) => { seen.push(e.text); return { text: e.text } })
  await $.session.start({ surface: null, isInteractive: false, cwd: 'C:/x' })
  for (const [c, has] of [['5\n', 'Why-behind review'], ['7', null]] as const) {
    count = c
    seen.length = 0
    const r = await $.tool.call({ tool: 'mcp__stool__restart_session', prompt: 'go' } as never)
    expect(String(r.result).includes('review added')).toBe(has !== null)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.advance(2000)
    expect(has === null ? seen[0] === 'go' : seen[0]!.includes(has) && seen[0]!.endsWith('Then: go')).toBe(true)
  }
  expect(reads[0]!.split(String.fromCharCode(92)).join('/')).toBe('C:/x/docs/restart_count.txt')
})
