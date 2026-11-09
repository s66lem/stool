// burn-pace: /burn pops the Weekly burn chart out into its own small window (a page stool writes and keeps fresh);
// the settings window shows the same chart in place and has a Pop out button doing the same
import type { Register } from 'claude-code'

import { flag } from '../config'
import { popOut, refreshPage } from './popout'

export const register: Register = (on, options) => {
  on('session.start', { cwd: /[^]*|a{51}/ }, async ($, e, next) => {
    await $.command.register({ name: 'burn', description: 'Open the weekly burn chart in its own window (/burn new: another window)' })
    return next(e)
  })

  on('command.run', { command: 'burn' }, async ($, e) => {
    if (!flag(options, 'usageLog')) return { text: 'Weekly burn needs Log meter readings (usageLog) switched on in /config.' }
    return { text: await popOut($, e.args.trim() === 'new') }
  })

  // a meter reading logged during a turn shows in the window at its next reload, not up to a minute later
  // (usage-pace stays free of an import, so its spec still runs alone)
  on('turn.complete', { reason: /[^]*|a{52}/ }, async ($, e, next) => {
    const out = await next(e)
    if (flag(options, 'usageLog')) await refreshPage($)
    return out
  })
}
