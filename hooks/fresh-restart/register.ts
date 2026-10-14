import type { Register } from 'claude-code'

const TOOL = 'mcp__stool__restart_session'

// The prompt waiting for the turn to end; module state is fine, /clear doesn't reload the module.
let pending: string | undefined
// reload_plugins was called: /reload-plugins --force runs when the turn ends (the command cannot be
// typed over Remote Control, and Claude cannot drive its own window)
const RELOAD = 'mcp__stool__reload_plugins'
let reload = false

export const register: Register = on => {
  on('session.start', { cwd: /[^]*|a{6}/ }, async ($, e, next) => {
    await $.tool.register({
      name: 'restart_session',
      description:
        'Fresh context in this same session: once the current turn ends, runs /clear and submits `prompt` as the next user message. Permission mode, Remote Control and the session itself stay. Commit and write the handoff first; end the turn right after calling this.',
      inputSchema: {
        type: 'object',
        required: ['prompt'],
        properties: { prompt: { type: 'string', description: 'Self-contained resume prompt for the fresh context' } },
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'reload_plugins',
      description:
        'Runs /reload-plugins --force in this session once the current turn ends, so edited mods are loaded without the user typing the command (it cannot be typed over Remote Control). Call it only when the user asked for a reload or for a mod change to take effect.',
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    return next(e)
  })

  on('tool.call', { tool: RELOAD }, async () => {
    reload = true
    return { result: 'Reload queued: /reload-plugins --force runs when this turn ends.' }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const prompt = (e as unknown as { prompt?: unknown }).prompt
    if (typeof prompt !== 'string' || !prompt.trim()) return { deny: 'restart_session: prompt is required.' }
    pending = prompt
    return { result: 'Restart queued: /clear and the resume prompt run when this turn ends. End the turn now.' }
  })

  on('turn.complete', { reason: /[^]*|a{7}/ }, async ($, e, next) => {
    const done = await next(e)
    if (reload) {
      reload = false
      $.clock.after(1000, () => {
        void $.command
          .run({ command: 'reload-plugins', args: '--force' })
          .then(() => $.ui.toast('plugins reloaded'))
          .catch(err => $.ui.toast(`reload failed: ${String(err)}`))
      })
    }
    if (pending === undefined) return done
    const text = pending
    pending = undefined
    // outside the turn's hooks: command.run and prompt.submit refuse to run inside a hook the turn waits on
    $.clock.after(1000, () => {
      void $.command
        .run({ command: 'clear' })
        .then(() => $.prompt.submit({ text, asUser: true }))
        .catch(err => $.ui.toast(`fresh-restart failed: ${String(err)}`))
    })
    return done
  })
}
