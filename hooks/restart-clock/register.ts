// restart-clock: tells the main loop when its session is due a restart: context at `restartContextAt` % (default 65),
// and, opt-in (`restartPublishCounter`), `restartPublishesAt` runs of a command matching `restartPublishPattern` since
// the handoff file was last rewritten. Opt-in too (`restartHandoffLint`): lints writes to the handoff file.
// Main loop only (a subagent has `e.agentId`); only in sessions under `projectRoots`.
import type { EngineInterface, Register } from 'claude-code'

import type { RestartStrip } from '../../types'
import { flag, inScope, num, pattern, roots, text } from '../config'

const slash = (p: unknown) => String(p ?? '').split(String.fromCharCode(92)).join('/')
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const CTX_AT = 65
// absolute context too: percent of a 1M window never fires before 650k, and 29% of lead $ was spent past 400k (measured 2026-10-24)
export const CTX_TOKENS = 150_000
const RENAG = 50_000
export const PUBLISHES_AT = 3
const STRIP = { plugin: 'stool', key: 'restart' } as const

// warnings about a handoff file as it stands now; `now` is ms since the epoch (what `date -u` prints)
export function lintHandoff(body: string, now: number, heading = 'RESUME HERE'): string[] {
  const heads = body.match(new RegExp(`^## ${esc(heading)}.*$`, 'gm')) ?? []
  const out: string[] = []
  if (heads.length > 1) out.push(`${heads.length} "## ${heading}" headings: rewrite the one block, demote the old one under "## Before".`)
  const first = heads[0]
  if (first) {
    const m = first.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
    if (!m) out.push(`the ${heading} heading carries no "YYYY-MM-DD HH:MMZ" time: take it from \`date -u\`.`)
    else {
      const at = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!)
      // ponytail: 30 minutes either way; a handoff written slowly would need a wider window
      if (Math.abs(now - at) > 30 * 60_000) out.push(`the ${heading} time ${m[0]}Z is not now (${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}Z): take it from \`date -u\`.`)
    }
  }
  return out
}

// `ctxAt` and `limit` (the publish count that makes a restart due; Infinity = counter off) come from the options
type S = { scoped: boolean; calls: number; ctx: number | null; tokens: number | null; tokAt: number; nagAt: number; base: number; governor: boolean; publishes: number; warned: boolean; note: boolean; ctxAt: number; limit: number }
const due = (s: S) => (s.ctx ?? 0) >= s.ctxAt || (s.tokAt > 0 && (s.tokens ?? 0) >= s.tokAt) || s.publishes >= s.limit

function publish($: EngineInterface, s: S) {
  const strip: RestartStrip = { ctx: s.ctx, publishes: s.publishes, due: due(s) }
  void $.state.set(STRIP, strip)
  if (!strip.due) s.warned = false
  else if (!s.warned || (s.tokens ?? 0) >= s.nagAt) {
    s.warned = true
    s.note = true
    s.nagAt = (s.tokens ?? 0) + RENAG
  }
}

// percent is absent on some hosts' readings: fall back to tokens over window
async function readCtx($: EngineInterface, s: S) {
  // the governor: the token threshold drops while the 5-hour or weekly window runs hot (usage-pace's squeeze)
  if (s.base > 0 && s.governor) {
    const sq = Number((await $.state.get({ plugin: 'stool', key: 'usage' }).catch(() => undefined))?.value?.squeeze ?? 0)
    s.tokAt = Math.round(s.base * [1, 0.67, 0.5][Math.min(2, Math.max(0, sq))]!)
  }
  const c = (await $.session.usage()).context
  const p = c.percent ?? (c.tokens !== undefined && c.window ? (100 * c.tokens) / c.window : undefined)
  if (p === undefined) return
  s.ctx = Math.round(p)
  s.tokens = c.tokens ?? (c.window ? Math.round((p * c.window) / 100) : null)
  publish($, s)
}

export const register: Register = (on, options) => {
  const counter = flag(options, 'restartPublishCounter') && text(options, 'restartPublishPattern') !== ''
  const ctxAt = num(options, 'restartContextAt', CTX_AT)
  const s: S = { scoped: false, calls: 0, ctx: null, tokens: null, tokAt: num(options, 'restartContextTokens', CTX_TOKENS), nagAt: 0, base: num(options, 'restartContextTokens', CTX_TOKENS), governor: options?.governor !== false, publishes: 0, warned: false, note: false, ctxAt, limit: counter ? num(options, 'restartPublishesAt', PUBLISHES_AT) : Infinity }
  const publishRe = pattern(text(options, 'restartPublishPattern'))
  const lint = flag(options, 'restartHandoffLint')
  const file = esc(text(options, 'restartHandoffFile', 'HANDOFF.md'))
  const heading = text(options, 'restartHandoffHeading', 'RESUME HERE')
  const fileRe = new RegExp(`(^|/)${file}$`)
  const rewriteRe = text(options, 'restartRewriteCommand') ? pattern(text(options, 'restartRewriteCommand')) : undefined

  const isRewrite = (e: { tool: string } & Record<string, unknown>) =>
    (e.tool === 'Edit' && fileRe.test(slash(e.file_path)) && new RegExp(esc(heading)).test(`${e.old_string}${e.new_string}`)) ||
    (e.tool === 'Write' && fileRe.test(slash(e.file_path)) && new RegExp(`^## ${esc(heading)}`, 'm').test(String(e.content))) ||
    ((e.tool === 'Bash' || e.tool === 'PowerShell') && rewriteRe?.test(String(e.command)) === true)

  on('session.start', { cwd: /[^]*|a{13}/ }, async ($, e, next) => {
    s.scoped = inScope(e.cwd, roots(options))
    return next(e)
  })

  on('classic.SessionStart', { source: /[^]*|a{43}/ }, async ($, e, next) => {
    const r = await next(e)
    if (s.scoped && e.source === 'clear') {
      s.ctx = null
      s.tokens = null
      s.publishes = 0
      publish($, s)
    }
    return r
  })

  on('turn.complete', { reason: /[^]*|a{14}/ }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || !(s.scoped ||= inScope(await $.session.cwd(), roots(options)))) return r
    await readCtx($, s)
    return r
  })

  for (const tool of ['Bash', 'PowerShell', 'Edit', 'Write'] as const)
    on('tool.call', { tool }, async ($, e, next) => {
      if (!s.scoped || e.agentId) return next(e)
      if (counter && isRewrite(e as never)) {
        s.publishes = 0
        publish($, s)
      } else if (counter && (tool === 'Bash' || tool === 'PowerShell') && publishRe.test((e as { command: string }).command)) {
        s.publishes += 1
        publish($, s)
      }
      // a long turn (a headless run, or many tool calls in a row) never reaches turn.complete: read the context here too, every 5th call
      if (++s.calls % 5 === 0) await readCtx($, s).catch(() => undefined)
      const r0 = await next(e)
      // once per due period, as a note on this tool result
      const r = s.note
        ? ((s.note = false), { ...r0, context: [...(r0.context ?? []), `restart-clock: restart due (${s.ctx !== null && s.ctx >= ctxAt ? `ctx ${s.ctx}%` : s.tokAt > 0 && (s.tokens ?? 0) >= s.tokAt ? `context ${Math.round((s.tokens ?? 0) / 1000)}k tokens, every message re-reads it${s.tokAt < s.base ? '; lowered because your usage window is running hot' : ''}` : `${s.publishes} publishes since the handoff was rewritten`}): run the session-restart skill at the next natural stop`] })
        : r0
      const path = slash((e as { file_path?: string }).file_path)
      if (!lint || r.deny !== undefined || r.isError || !fileRe.test(path)) return r
      let body: string
      try {
        body = await $.fs.read(path)
      } catch {
        return r
      }
      const warnings = lintHandoff(body, await $.clock.now(), heading)
      if (warnings.length === 0) return r
      $.ui.toast(`${path.split('/').pop()}: ${warnings[0]}`)
      return { ...r, context: [...(r.context ?? []), ...warnings.map(w => `restart-clock warning: ${w}`)] }
    }).catch(($, e, next) => next(e)) // a bug here fails open
}
