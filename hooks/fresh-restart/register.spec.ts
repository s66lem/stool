import { expect, mock, test, tier } from 'claude-code/testing'

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

test('reload_plugins: when /reload-plugins is refused remotely, bumping an option reloads the plugin instead', async ($, on) => {
  const clock = mock.clock(on, { now: 5_000_000 })
  const seen: unknown[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.run', () => ({ text: 'reload-plugins is not available through a remote session' }) as never)
  on('config.set', (_$, e: any) => { seen.push([e.key, e.value]); return { value: e.value } as never })
  on('ui.toast', (_$, e: any) => { seen.push(e.text); return { value: undefined } as never })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  await $.session.start({ surface: null, isInteractive: false, cwd: 'C:/x' })
  await $.tool.call({ tool: 'mcp__stool__reload_plugins' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(2000)
  expect(seen[0]).toEqual(['stool.reloadNonce', 5001])
  expect(String(seen[1])).toContain('stool reloaded')
})
