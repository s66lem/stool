// bypass (opt-in `bypassCommand`): `/bypass on|off` makes this session stop asking for permission, where the client
// has no mode picker for it (Remote Control on a phone). It turns the engine's `ask` verdict into `allow`; a `deny`
// (a settings rule, another plugin's guard) still stands, and a tool that needs the person (a question, a plan) is
// still put to them. A plugin reload puts it back to off.
import type { Register } from 'claude-code'

import { flag } from '../config'

let isOn = false

export const register: Register = (on, options) => {
  if (!flag(options, 'bypassCommand')) return

  on('session.start', { cwd: /[^]*|a{33}/ }, async ($, e, next) => {
    await $.command.register({ name: 'bypass', description: 'Stop asking for permission in this session: /bypass on, /bypass off, /bypass for the state' })
    return next(e)
  })

  on('command.run', { command: 'bypass' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') isOn = arg === 'on'
    else if (arg !== '') return { text: 'Usage: /bypass on, /bypass off, or /bypass for the state.' }
    $.ui.status(isOn ? 'bypass on' : undefined)
    return { text: isOn ? 'Bypass is on: tool calls run without asking (deny rules and guards still apply). /bypass off turns it off.' : 'Bypass is off.' }
  })

  on('tool.check', async ($, e, next) => {
    const v = await next(e)
    return isOn && v.decision === 'ask' ? { ...v, decision: 'allow' as const, reason: 'bypass is on (/bypass off)' } : v
  })
}
