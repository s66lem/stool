// burn-pace: /burn shows or hides a pane with the Weekly burn chart (the same chart the settings window shows)
import type { Register, Timer } from 'claude-code'

import { flag } from '../config'
import { burnView } from './burn'

const PANE = 'burn-pace'

export const register: Register = (on, options) => {
  let tick: Timer | undefined
  const stop = () => {
    tick?.cancel()
    tick = undefined
  }

  on('session.start', { cwd: /[^]*|a{51}/ }, async ($, e, next) => {
    await $.command.register({ name: 'burn', description: 'Show or hide the weekly burn chart' })
    return next(e)
  })

  on('command.run', { command: 'burn' }, async $ => {
    if (!flag(options, 'usageLog')) return { text: 'Weekly burn needs Log meter readings (usageLog) switched on in /config.' }
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Weekly burn closed.' }
    }
    await $.ui.open({ id: PANE, title: 'Weekly burn' })
    stop()
    // redraw each minute while open: a reading usage-pace logged shows within a minute
    tick = $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    return { text: 'Weekly burn opened.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stop()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => burnView($, e, flag(options, 'usageLog')))
}
