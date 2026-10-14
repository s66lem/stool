// lead-guard (opt-in `leadGuard`): known slips of the main loop, denied where they happen. The main loop only (a
// subagent has `e.agentId`; worktree agents legitimately cd and stage), and only in sessions under `projectRoots`.
import type { Register } from 'claude-code'

import { flag, inScope, norm, pattern, roots, text } from '../config'

const WRITE = /writeFile|appendFile|write_text|\.write\(|open\([^)]*['"][wa]|Out-File|Set-Content|Add-Content/

// the options that shape the check: `docs` = paths whose shell writes are denied, `checks` = scripts whose output must
// not be piped through tail/head (both are regex sources; empty turns that rule off)
export type Rules = { docs: string; checks: string }
export const RULES: Rules = { docs: String.raw`docs/|CLAUDE\.md`, checks: String.raw`(check|merge)\.mjs` }

// a one-line fix, or undefined when the command is fine. `root` is the session's cwd.
export function check(cmd: string, root: string, rules: Rules = RULES): string | undefined {
  if (/\bgit\b[^|;&\n]*\badd\b[^|;&\n]*?(\s-A\b|\s--all\b|\s\.(?=\s|$|[;&|]))/.test(cmd))
    return 'git add -A / git add . stages other work: stage named paths.'
  if (rules.docs && !/\bgit\s+commit\b/.test(cmd) && pattern(rules.docs).test(cmd)) {
    const redirect = pattern(String.raw`(?:^|[^>\d&])>>?\s*["']?[^\s"'|&;]*(?:${rules.docs})`).test(cmd)
    const script = /\b(node\s+(-e|--eval)|python3?\s+-c)\b|<<-?\s*['"]?\w+|@['"]\s*$/m.test(cmd) && WRITE.test(cmd)
    if (/\bsed\s+(-\w*i|--in-place)/.test(cmd) || redirect || script || /\b(Set|Add)-Content\b|\bOut-File\b/.test(cmd))
      return 'writing these files from the shell loses edits to quoting: use Edit/Write.'
  }
  if (rules.checks && pattern(String.raw`(${rules.checks})[^\n]*\|\s*(tail|head)\b`).test(cmd) && !/pipefail/.test(cmd))
    return '| tail hides a failing check: add set -o pipefail.'
  const r = norm(root)
  // a cd inside ( ... ) or $( ... ) runs in a subshell and leaves the session directory alone
  let top = cmd
  for (let prev = ''; prev !== top; ) [prev, top] = [top, top.replace(/\([^()]*\)/g, '')]
  for (const m of top.matchAll(/(?:^|[;&|\n(]\s*)(?:cd|Set-Location|pushd)\s+(?:-\w+\s+)?("[^"]*"|'[^']*'|[^\s;&|)]+)/g)) {
    const t = (m[1] ?? '').replace(/^["']|["']$/g, '')
    if (t === '' || t === '-' || (t.startsWith('$') && !/^\$(env:)?home/i.test(t))) continue
    const out = t === '~' || t.startsWith('~/') || /^\$/.test(t) ? true : /^([a-z]:|\/)/i.test(t) ? !(norm(t) + '/').startsWith(r + '/') : t.startsWith('..')
    if (out) return `cd to ${t} leaves the repo root and moves the session directory: use git -C / absolute paths.`
  }
  return undefined
}

const IMG = /\.(jpe?g|png)$/i
const NUDGE = 'lead-guard: full-size image read #%N% this session. Hand image checks to a cheaper subagent, or tile the images, unless this one is the deliverable.'

export const register: Register = (on, options) => {
  if (!flag(options, 'leadGuard')) return
  const rules: Rules = { docs: text(options, 'leadGuardDocPaths', RULES.docs), checks: text(options, 'leadGuardCheckScripts', RULES.checks) }
  const nudge = flag(options, 'leadGuardImageNudge')
  let root = ''
  let scoped = false
  let images = 0

  on('session.start', { cwd: /[^]*|a{12}/ }, ($, e, next) => {
    root = e.cwd
    scoped = inScope(e.cwd, roots(options))
    return next(e)
  })
  on('classic.SessionStart', { source: /[^]*|a{42}/ }, async ($, e, next) => {
    if (e.source === 'clear') images = 0
    return next(e)
  }).catch(($, e, next) => next(e))

  for (const tool of ['Bash', 'PowerShell'] as const)
    on('tool.call', { tool }, ($, e, next) => {
      if (!scoped || e.agentId) return next(e)
      const fix = check(e.command, root, rules)
      return fix ? { deny: `lead-guard: ${fix}` } : next(e)
    }).catch(($, e, next) => next(e)) // a bug here fails open

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const r = await next(e)
    if (!nudge || !scoped || e.agentId || r.deny !== undefined || r.isError || !IMG.test(e.file_path)) return r
    images += 1
    if (images === 3 || (images > 3 && images % 5 === 0)) return { ...r, context: [...(r.context ?? []), NUDGE.replace('%N%', String(images))] }
    return r
  }).catch(($, e, next) => next(e))
}
