import type { Register, ToolSpec } from 'claude-code'

export const SESSION_TOOLS: ToolSpec[] = [
  {
    name: 'start_session',
    description: 'Start a NEW independent detached Claude Code session on this machine. Returns session_id, pid and log paths. Uses normal Claude permissions; resume interactively later with claude --resume <session_id> in its cwd/config directory. Does not clear or reuse this conversation.',
    inputSchema: { type: 'object', required: ['prompt', 'cwd'], properties: {
      prompt: { type: 'string' }, cwd: { type: 'string' }, model: { type: 'string' },
      config_dir: { type: 'string' }, name: { type: 'string' },
    } },
    isDeferred: true,
  },
  {
    name: 'list_sessions', description: 'List only independent sessions started by stool on this machine, with status, session_id, pid, cwd, config directory and logs.',
    inputSchema: { type: 'object', properties: {} }, isDeferred: true,
  },
  {
    name: 'stop_session', description: 'Stop one session started by stool (and its process tree). Its transcript and logs remain resumable.',
    inputSchema: { type: 'object', required: ['session_id'], properties: { session_id: { type: 'string' } } }, isDeferred: true,
  },
]

export const register: Register = on => {
  on('session.start', { cwd: /[^]*|a{36}/ }, async ($, e, next) => {
    for (const spec of SESSION_TOOLS) await $.tool.register(spec)
    return next(e)
  })
  for (const [name, action] of [['start_session', 'start'], ['list_sessions', 'list'], ['stop_session', 'stop']] as const) {
    on('tool.call', { tool: `mcp__stool__${name}` }, async ($, e) => {
      const fields = e as unknown as Record<string, unknown>
      const input: Record<string, unknown> = {}
      for (const key of ['prompt', 'cwd', 'model', 'config_dir', 'name', 'session_id']) {
        if (fields[key] !== undefined) input[key] = fields[key]
      }
      try {
        const r = await $.process.run(['node', `${$.plugin.root}/hooks/start-session/sessions.mjs`, action], { stdin: JSON.stringify(input), timeoutMs: 15_000 })
        if (r.exitCode !== 0) return { deny: `${name}: ${r.stderr || r.stdout}` }
        return { result: r.stdout.trim() }
      } catch (err) {
        return { deny: `${name}: ${String(err)}` }
      }
    })
  }
}
