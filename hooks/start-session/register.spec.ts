import { expect, test, tier } from 'claude-code/testing'

tier('user')

test('start/list/stop register and forward long prompts as JSON stdin', async ($, on) => {
  const names: string[] = []
  const calls: string[][] = []
  const inputs: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => { names.push(e.name); return { value: undefined } as never })
  on('process.run', (_$, e: any) => { calls.push(e.argv); inputs.push(e.init.stdin); return { value: { stdout: '{"session_id":"id","pid":42}', stderr: '', exitCode: 0 } } as never })
  await $.session.start({ surface: null, isInteractive: false, cwd: 'C:/x' })
  expect(names).toContain('start_session')
  expect(names).toContain('list_sessions')
  expect(names).toContain('stop_session')
  const input = { prompt: 'hello "quotes"\nnext line' + 'x'.repeat(40000), cwd: 'C:/space dir', model: 'sonnet', config_dir: 'C:/account', name: 'seat' }
  const result = await $.tool.call({ tool: 'mcp__stool__start_session', ...input } as never)
  expect(String(result.result)).toContain('session_id')
  expect(calls[0].length).toBe(3)
  expect(JSON.parse(inputs[0])).toEqual(input)
  await $.tool.call({ tool: 'mcp__stool__list_sessions' } as never)
  await $.tool.call({ tool: 'mcp__stool__stop_session', session_id: 'id' } as never)
  expect(calls.map(c => c[2])).toEqual(['start', 'list', 'stop'])
})

test('helper failures are returned as tool errors', async ($, on) => {
  on('process.run', () => ({ value: { stdout: '', stderr: 'bad cwd', exitCode: 1 } }) as never)
  const result = await $.tool.call({ tool: 'mcp__stool__start_session', prompt: 'go', cwd: 'missing' } as never)
  expect(String(result.deny)).toContain('bad cwd')
})
