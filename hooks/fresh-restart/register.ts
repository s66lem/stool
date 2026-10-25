import type { Register, ToolSpec } from 'claude-code'

const TOOL = 'mcp__stool__restart_session'

// The prompt waiting for the turn to end; module state is fine, /clear doesn't reload the module.
let pending: string | undefined
// optional model for /model, run after the clear and before the prompt
let model: string | undefined
// reload_plugins was called: /reload-plugins --force runs when the turn ends (the command cannot be
// typed over Remote Control, and Claude cannot drive its own window)
const RELOAD = 'mcp__stool__reload_plugins'
let reload = false

export const RESTART_TOOL: ToolSpec = {
  name: 'restart_session',
  description:
    'Fresh context in this same session: once the current turn ends, runs /clear and submits `prompt` as the next user message. Permission mode, Remote Control and the session itself stay. Commit and write the handoff first; end the turn right after calling this. `model` is optional; switches this session to that model before the resume prompt.',
  inputSchema: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', description: 'Self-contained resume prompt for the fresh context' },
      model: { type: 'string', description: 'Optional; model alias or id ("sonnet", "opus", "claude-sonnet-5-5") to switch to before the prompt' },
    },
  },
  isDeferred: true,
}

export const RELOAD_TOOL: ToolSpec = {
  name: 'reload_plugins',
  description:
    'Runs /reload-plugins --force in this session once the current turn ends, so edited mods are loaded without the user typing the command (it cannot be typed over Remote Control). Call it only when the user asked for a reload or for a mod change to take effect.',
  inputSchema: { type: 'object', properties: {} },
  isDeferred: true,
}

export const register: Register = on => {
  on('session.start', { cwd: /[^]*|a{6}/ }, async ($, e, next) => {
    await $.tool.register(RESTART_TOOL)
    await $.tool.register(RELOAD_TOOL)
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
    const m = (e as unknown as { model?: unknown }).model
    model = undefined
    let note = ''
    if (typeof m === 'string' && m.trim()) {
      if (/^[\w.[\]-]+$/.test(m.trim())) {
        model = m.trim()
        note = ` The model switches to ${model} before the prompt.`
      } else note = ' The model was not changed (unrecognised model name).'
    }
    return { result: `Restart queued: /clear and the resume prompt run when this turn ends.${note} End the turn now.` }
  })

  on('turn.complete', { reason: /[^]*|a{7}/ }, async ($, e, next) => {
    const done = await next(e)
    if (reload) {
      reload = false
      $.clock.after(1000, () => {
        void $.command
          .run({ command: 'reload-plugins', args: '--force' })
          .then(r => {
            // a remote session answers with text instead of reloading
            const said = String((r as { text?: unknown }).text ?? '')
            if (/remote/i.test(said)) throw new Error(said)
            $.ui.toast('plugins reloaded')
          })
          // the command is refused over Remote Control: a changed option reloads the plugin, so bump an unused one
          // ponytail: reloads stool only, not the other plugins, and writes the counter to the user's settings
          .catch(async () => {
            const n = Math.floor((await $.clock.now()) / 1000)
            await $.config
              .set({ key: 'stool.reloadNonce', value: n })
              .then(r => $.ui.toast(r.deny ? `reload failed: ${r.deny}` : 'stool reloaded (reload-plugins is not available remotely)'))
              .catch((err: unknown) => $.ui.toast(`reload failed: ${String(err)}`))
          })
      })
    }
    if (pending === undefined) return done
    const text = pending
    pending = undefined
    const m = model
    model = undefined
    // outside the turn's hooks: command.run and prompt.submit refuse to run inside a hook the turn waits on
    $.clock.after(1000, () => {
      void $.command
        .run({ command: 'clear' })
        .then(async () => {
          // an unknown model must not block the restart; /model answers with text or throws
          if (m) await $.command.run({ command: 'model', args: m }).catch(err => $.ui.toast(`model not changed: ${String(err)}`))
        })
        .then(() => $.prompt.submit({ text, asUser: true }))
        .catch(err => $.ui.toast(`fresh-restart failed: ${String(err)}`))
    })
    return done
  })
}
