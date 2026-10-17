// bypass (opt-in `bypassCommand`): `/bypass on|off` makes this session stop asking for permission, where the client
// has no mode picker for it (Remote Control on a phone). It turns the engine's `ask` verdict into `allow`; a `deny`
// (a settings rule, another plugin's guard) still stands, and a tool that needs the person (a question, a plan) is
// still put to them. A plugin reload puts a plain `on` back to off.
// `/bypass --persist` keeps it on for the project folder (and below it): every session there, running now or started
// later, is bypassed again whatever happened to its own switch. Only `/bypass off --persist` ends that. The list of
// folders is in the store, shared by all sessions on this machine.
import type { EngineInterface, Register } from 'claude-code'

import { flag, inScope, norm } from '../config'

const KEY = 'bypass-folders'
const REREAD_MS = 5000 // another session's `--persist` reaches a running session within this
let isOn = false
let folders: string[] = []
let readAt = -Infinity

async function refresh($: EngineInterface, force = false) {
  const now = await $.clock.now()
  if (!force && now - readAt < REREAD_MS) return
  readAt = now
  const v = await $.store.get(KEY).catch(() => undefined)
  folders = Array.isArray(v) ? (v as string[]).filter(f => typeof f === 'string' && f) : []
}

const covers = (cwd: string) => folders.filter(f => inScope(cwd, [f]))

export const register: Register = (on, options) => {
  if (!flag(options, 'bypassCommand')) return

  on('session.start', { cwd: /[^]*|a{33}/ }, async ($, e, next) => {
    await $.command.register({ name: 'bypass', description: 'Stop asking for permission in this session: /bypass on, /bypass off; --persist keeps it on for this project folder; /bypass alone shows the state' })
    await refresh($, true)
    if (covers(e.cwd).length > 0) $.ui.status('bypass on (folder)')
    return next(e)
  })

  on('command.run', { command: 'bypass' }, async ($, e) => {
    const args = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const persist = args.includes('--persist')
    const word = args.find(a => !a.startsWith('--'))
    if ((word !== undefined && word !== 'on' && word !== 'off') || args.some(a => a.startsWith('--') && a !== '--persist'))
      return { text: 'Usage: /bypass on | off, add --persist to keep it for this project folder, /bypass alone for the state.' }
    const cwd = await $.session.cwd()
    await refresh($, true)
    let note = ''
    if (persist && word !== 'off') {
      isOn = true
      const here = norm(cwd)
      if (covers(cwd).length === 0) {
        folders = [...folders, here]
        await $.store.set(KEY, folders)
      }
      note = ` Kept for ${covers(cwd)[0]} and below: every session there is bypassed, /bypass off --persist ends it.`
    } else if (persist) {
      const gone = covers(cwd)
      folders = folders.filter(f => !gone.includes(f))
      await $.store.set(KEY, folders)
      isOn = false
      note = gone.length > 0 ? ' No longer kept for this folder.' : ' This folder was not kept.'
    } else if (word === 'off') {
      if (covers(cwd).length > 0) return { text: `Bypass is kept for ${covers(cwd)[0]}: /bypass off --persist ends it (a plain off would be turned back on).` }
      isOn = false
    } else if (word === 'on') isOn = true
    const kept = covers(cwd).length > 0
    $.ui.status(isOn || kept ? (kept ? 'bypass on (folder)' : 'bypass on') : undefined)
    return { text: (isOn || kept ? 'Bypass is on: tool calls run without asking (deny rules and guards still apply).' : 'Bypass is off.') + note }
  })

  on('tool.check', { tool: /[^]*|a{34}/ }, async ($, e, next) => {
    const v = await next(e)
    if (v.decision !== 'ask') return v
    await refresh($)
    return isOn || covers(await $.session.cwd()).length > 0 ? { ...v, decision: 'allow' as const, reason: 'bypass is on (/bypass off)' } : v
  })
}
