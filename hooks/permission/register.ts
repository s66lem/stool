// permission (opt-in `bypassCommand`): `/stoolpermission <mode> [--persist]` sets the permission mode of this session, for
// clients whose mode picker lacks one (Remote Control on a phone has no bypass).
//  - bypassPermissions: the engine will not take that mode from a plugin, so the `ask` verdict is turned into `allow`
//    here; a `deny` (a settings rule, a guard) still stands, and a tool that needs the person is still put to them.
//  - default, acceptEdits, auto, dontAsk: the real mode, set when a permission prompt comes up in a session that is in
//    another one (a PermissionRequest hook answers allow for that one call and sets the session's mode).
// `--persist` keeps the mode for the project folder and below: every session there, running or started later, is held
// to it. Only `/stoolpermission off --persist` ends that. The folders are in the store, shared by all sessions here.
import type { EngineInterface, Register } from 'claude-code'

import { flag, inScope, norm } from '../config'

const KEY = 'permission-folders' // { "<folder>": "<mode>" }
const OLD_KEY = 'bypass-folders' // 2.7-2.8: a list of folders, all bypass
const REREAD_MS = 5000 // another session's `--persist` reaches a running session within this
const MODES = ['default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'] as const
type Mode = (typeof MODES)[number]
const ALIAS: Record<string, Mode> = { bypass: 'bypassPermissions', accept: 'acceptEdits', edits: 'acceptEdits', ask: 'default', dontask: 'dontAsk' }
const parseMode = (w: string): Mode | undefined => MODES.find(m => m.toLowerCase() === w) ?? ALIAS[w]

let mine: Mode | undefined // set by a plain `/stoolpermission <mode>`; a plugin reload forgets it
let kept: Record<string, Mode> = {}
let readAt = -Infinity

async function refresh($: EngineInterface, force = false) {
  const now = await $.clock.now()
  if (!force && now - readAt < REREAD_MS) return
  readAt = now
  const v = (await $.store.get(KEY).catch(() => undefined)) as Record<string, string> | undefined
  const old = await $.store.get(OLD_KEY).catch(() => undefined)
  kept = {}
  if (Array.isArray(old)) for (const f of old) if (typeof f === 'string' && f) kept[f] = 'bypassPermissions'
  if (v && typeof v === 'object') for (const [f, m] of Object.entries(v)) if (MODES.includes(m as Mode)) kept[f] = m as Mode
}

// the kept folders that hold `cwd`, the nearest first
const covers = (cwd: string) => Object.keys(kept).filter(f => inScope(cwd, [f])).sort((a, b) => b.length - a.length)
const wanted = (cwd: string): Mode | undefined => mine ?? kept[covers(cwd)[0] ?? '']

async function save($: EngineInterface) {
  await $.store.set(KEY, kept)
  await $.store.set(OLD_KEY, []) // the migrated list is not read again
}

export const register: Register = (on, options) => {
  if (!flag(options, 'bypassCommand')) return

  on('session.start', { cwd: /[^]*|a{33}/ }, async ($, e, next) => {
    await $.command.register({
      name: 'stoolpermission',
      description: `Set this session's permission mode: /stoolpermission ${MODES.join('|')}, add --persist to hold the project folder to it; off to end; alone for the state`,
    })
    await refresh($, true)
    const m = wanted(e.cwd)
    if (m) $.ui.status(`permission: ${m}`)
    return next(e)
  })

  on('command.run', { command: 'stoolpermission' }, async ($, e) => {
    const args = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const persist = args.includes('--persist')
    const word = args.find(a => !a.startsWith('--'))
    const mode = word === undefined || word === 'off' || word === 'status' ? undefined : parseMode(word)
    const usage = `Usage: /stoolpermission ${MODES.join(' | ')} [--persist], /stoolpermission off [--persist], or /stoolpermission for the state.`
    if (args.some(a => a.startsWith('--') && a !== '--persist') || (word !== undefined && word !== 'off' && word !== 'status' && !mode)) return { text: usage }
    const cwd = await $.session.cwd()
    await refresh($, true)
    const here = covers(cwd)
    let note = ''
    if (mode) {
      mine = mode
      if (persist) {
        kept[here[0] ?? norm(cwd)] = mode
        await save($)
        note = ` Held for ${here[0] ?? norm(cwd)} and below: every session there is held to it; /stoolpermission off --persist ends it.`
      }
      if (mode !== 'bypassPermissions') note += ' It takes effect at the next permission prompt.'
    } else if (word === 'off') {
      if (persist) {
        for (const f of here) delete kept[f]
        await save($)
        mine = undefined
        note = here.length > 0 ? ' No longer held for this folder.' : ' This folder was not held.'
      } else if (here.length > 0) {
        return { text: `A mode is held for ${here[0]}: /stoolpermission off --persist ends it (a plain off would be put back).` }
      } else mine = undefined
    }
    const now = wanted(cwd)
    $.ui.status(now ? `permission: ${now}` : undefined)
    return { text: (now ? `Permission mode ${now}${mine ? '' : ' (held for the folder)'}.` : 'No permission mode set by stool.') + note }
  })

  // bypassPermissions: ask becomes allow
  on('tool.check', { tool: /[^]*|a{34}/ }, async ($, e, next) => {
    const v = await next(e)
    if (v.decision !== 'ask') return v
    await refresh($)
    return wanted(await $.session.cwd()) === 'bypassPermissions' ? { ...v, decision: 'allow' as const, reason: 'permission mode set by /stoolpermission' } : v
  })

  // every other mode: when a prompt comes up in a session that is not in the wanted mode, put the session in it
  on('classic.PermissionRequest', { tool_name: /[^]*|a{44}/ }, async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    const m = wanted(e.cwd)
    if (!m || m === 'bypassPermissions' || e.permission_mode === m) return r
    return { ...r, decision: { behavior: 'allow' as const, updatedPermissions: [{ type: 'setMode' as const, mode: m, destination: 'session' as const }] } }
  })
}
