import { expect, mock, test, tier } from 'claude-code/testing'

import { TIERS_DEFAULT, dueTiers, parseTiers, tierLine } from '../config'
import { RESUME_CAP, resumeSection, withReviews } from './register'

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

test('restart_session: a wake turn that starts after the clear cannot lose the resume prompt; a refused submit is retried', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const seen: string[] = []
  const files = new Map<string, string>()
  let refuse = 0
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.run', (_$, e) => { seen.push(e.command); return { text: '' } })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('turn.start', (_$, e) => ({ ...e }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('fs.write', (_$, e: any) => { files.set(e.path, e.text); return { value: undefined } })
  on('prompt.submit', (_$, e) => {
    if (refuse > 0) { refuse--; throw new Error('a turn is running') }
    seen.push(`prompt ${e.text}`)
    return { text: e.text }
  })
  await $.session.start({ surface: null, isInteractive: false, cwd: 'C:/x' })
  const done = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never
  const marker = () => JSON.parse([...files.entries()].find(([k]) => k.endsWith('restart-pending.json'))![1]).pending
  await $.tool.call({ tool: 'mcp__stool__restart_session', prompt: 'go' } as never)
  expect(marker()).toBe(true) // tripwire reads this to hold its wakes
  // a wake turn starts before the restart's own try runs: the prompt waits for that turn's end
  await $.turn.complete(done)
  await $.turn.start({ text: 'wake', turnId: 'w1' } as never)
  await clock.advance(10_000)
  expect(seen.filter(x => x.startsWith('prompt'))).toEqual([])
  expect(marker()).toBe(true)
  await $.turn.complete(done)
  await clock.advance(2000)
  expect(seen).toEqual(['clear', 'prompt go']) // one clear, the prompt after the wake turn
  expect(marker()).toBe(false)
  // a refused submit is retried on a timer, and the clear is not run twice
  seen.length = 0
  refuse = 2
  await $.tool.call({ tool: 'mcp__stool__restart_session', prompt: 'again' } as never)
  await $.turn.complete(done)
  await clock.advance(30_000)
  expect(seen).toEqual(['clear', 'prompt again'])
  expect(marker()).toBe(false)
})

test('resumeSection: the RESUME HERE block up to the next ## header, cut at the cap; empty when absent', () => {
  const body = '# H\r\n\r\n## RESUME HERE (2026-11-08 01:00Z)\r\nstate: x\r\n### sub\r\nkept\r\n## Before\r\nold\r\n'
  expect(resumeSection(body)).toBe('## RESUME HERE (2026-11-08 01:00Z)\nstate: x\n### sub\nkept')
  expect(resumeSection('## RESUME HERE\nlast block, no header after')).toBe('## RESUME HERE\nlast block, no header after')
  expect(resumeSection('# H\n## Before\nold')).toBe('')
  expect(resumeSection('## NOW\nx', 'NOW')).toBe('## NOW\nx')
  const big = resumeSection('## RESUME HERE\n' + 'y'.repeat(RESUME_CAP * 2))
  expect(big.length).toBeLessThan(RESUME_CAP + 40)
  expect(big.endsWith(`[... cut at ${RESUME_CAP} chars]`)).toBe(true)
})

const COMPACT = { options: { restartMode: 'compact' } }
const DONE = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never

// the engine pieces a compact restart touches; `fireStart` = the compaction raises SessionStart(compact) inside /compact
function compactWorld($: any, on: any, fireStart: boolean, files: Map<string, string>) {
  const w = { seen: [] as string[], bash: [] as any[], ctx: [] as string[], submits: [] as any[], denyBash: false }
  on('session.start', (_$: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:' + String.fromCharCode(92) + 'x' }) as never)
  on('fs.read', (_$: unknown, e: any) => {
    const v = files.get(String(e.path).split(String.fromCharCode(92)).join('/'))
    if (v === undefined) throw new Error('ENOENT')
    return { value: v } as never
  })
  on('fs.write', (_$: unknown, e: any) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('tool.register', (_$: unknown, e: any) => ({ value: { tool: e.name } }))
  on('classic.SessionStart', () => ({}) as never)
  on('command.run', async (_$: unknown, e: any) => {
    w.seen.push(`${e.command} ${e.args}`.trim())
    if (e.command === 'compact' && fireStart) w.ctx = ((await $.classic.SessionStart({ source: 'compact' } as never)) as any).additionalContext ?? []
    return { text: '' }
  })
  on('tool.call', { tool: 'Bash' }, (_$: unknown, e: any) => {
    if (w.denyBash) return { deny: 'Bash is not available here' } as never
    w.bash.push(e)
    return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } } as never
  })
  on('turn.complete', (_$: unknown, e: any) => ({ text: e.answer }))
  on('turn.start', (_$: unknown, e: any) => ({ ...e }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('prompt.submit', (_$: unknown, e: any) => {
    w.submits.push(e)
    return { text: e.text }
  })
  return w
}
const fileOf = (files: Map<string, string>, end: string) => [...files.entries()].find(([k]) => k.endsWith(end))?.[1]

test('restartMode compact: /compact <focus>, then the resume prompt and RESUME HERE as SessionStart(compact) context, and a background-task wake; no user message', COMPACT, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const files = new Map([
    ['C:/x/docs/restart_count.txt', '7\n'],
    ['C:/x/docs/HANDOFF.md', '# Handoff\n\n## RESUME HERE (2026-11-08 01:00Z)\nnext: ship it\n### detail\nkept\n## Before\nold stuff\n'],
  ])
  const w = compactWorld($, on, true, files)
  await $.session.start({ surface: null, isInteractive: false, cwd: 'C:/x' })
  const r = await $.tool.call({ tool: 'mcp__stool__restart_session', prompt: 'In C:/x: go on' } as never)
  expect(r.result).toContain('compact mode, restart #7')
  expect(JSON.parse(fileOf(files, 'restart-pending.json')!).pending).toBe(true)
  await $.turn.complete(DONE)
  await clock.advance(2000)
  expect(w.seen.length).toBe(1)
  expect(w.seen[0]).toMatch(/^compact stool restart #7: keep the current task state.*Next: In C:\/x: go on$/)
  expect(w.ctx.length).toBe(1)
  for (const has of ['restart #7, compact mode', 'In C:/x: go on', 'next: ship it', '### detail']) expect(w.ctx[0]).toContain(has)
  expect(w.ctx[0]).not.toContain('old stuff')
  // the wake: a background cat of the wake file, whose text points at the injected context (not a second copy)
  expect(w.bash.length).toBe(1)
  expect(w.bash[0].run_in_background).toBe(true)
  expect(w.bash[0].command).toContain('restart-wake.txt')
  expect(fileOf(files, 'restart-wake.txt')).toContain('Continue with it now')
  expect(fileOf(files, 'restart-wake.txt')).not.toContain('go on')
  expect(JSON.parse(fileOf(files, 'restart-pending.json')!).pending).toBe(false)
  // the wake's turn starts: no prompt is ever submitted
  await $.turn.start({ text: 'wake', turnId: 'w1' } as never)
  await clock.advance(70_000)
  expect(w.submits).toEqual([])
  // a later compaction that is not a restart adds nothing
  expect(((await $.classic.SessionStart({ source: 'compact' } as never)) as any).additionalContext ?? []).toEqual([])
})

test('restartMode compact fallbacks: no SessionStart(compact) puts the context in the wake; no turn in 60 s or a refused wake sends a framed automated prompt', COMPACT, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const files = new Map<string, string>() // no handoff, no count
  const w = compactWorld($, on, false, files)
  await $.session.start({ surface: null, isInteractive: false, cwd: 'C:/x' })
  await $.tool.call({ tool: 'mcp__stool__restart_session', prompt: 'go on' } as never)
  await $.turn.complete(DONE)
  await clock.advance(2000)
  const wake = fileOf(files, 'restart-wake.txt')!
  for (const has of ['no resume context was injected', 'go on', 'Only the resume prompt was injected', 'could not be read']) expect(wake).toContain(has)
  expect(w.submits).toEqual([])
  await clock.advance(61_000) // no turn started
  expect(w.submits.length).toBe(1)
  expect(w.submits[0].asUser).toBeUndefined()
  expect(w.submits[0].text).toMatch(/^\[automated, not the user: stool restart wake\]/)
  expect(w.submits[0].text).toContain('started no turn in 60 s')
  // a refused background task: the framed prompt at once
  w.submits.length = 0
  w.denyBash = true
  await $.tool.call({ tool: 'mcp__stool__restart_session', prompt: 'again' } as never)
  await $.turn.complete(DONE)
  await clock.advance(2000)
  expect(w.submits.length).toBe(1)
  expect(w.submits[0].text).toContain('could not start')
  expect(w.submits[0].text).toContain('again')
})
