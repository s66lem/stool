import type { EngineInterface, Register, ToolSpec } from 'claude-code'

import { type Tier, dueTiers, parseTiers, text as opt } from '../config'
import { RELOAD_STAMP } from '../reload-stamp'

type $T = EngineInterface

const TOOL = 'mcp__stool__restart_session'

// The prompt waiting for the turn to end; module state is fine, /clear doesn't reload the module.
let pending: string | undefined
// optional model for /model, run after the clear and before the prompt
let model: string | undefined
let cleared = false // /clear (and /model) already ran for this restart; a retry only submits
let tries = 0 // submits made
let clearFails = 0
let trying = false
let busy = false // a (non-agent) turn is running
// restartMode "compact": /compact <focus> instead of /clear; the resume text goes in as context at the compaction's
// SessionStart (source compact), and a background-task notification starts the next turn (no user message)
let mode: 'clear' | 'compact' = 'clear'
let focus = ''
let restartN = 0
let compacting = false // a compact restart is between its /compact and its finish: SessionStart(compact) injects once
let injected = false
let waking: { body: string } | undefined // the wake task is out; cleared by the next main-loop turn.start
let cfg = { mode: 'clear' as 'clear' | 'compact', resumeFile: 'docs/HANDOFF.md', heading: 'RESUME HERE' }
const CONFIRM_MS = 60_000 // a task wake must start a turn this soon, else a framed prompt goes instead
const WAKE_DESC = 'stool restart wake: read this output'
export const WAKE_FILE = '~/.claude/stool/restart-wake.txt'
export const RESUME_CAP = 12_000
const MAX_TRIES = 5
const RETRY_MS = 4000
// Other plugins read this to hold their own wake-ups until the resume prompt is in (tripwire does; no import needed).
// { pending: true, at: ms } from the restart_session call until the prompt is submitted (or given up); then { pending: false }.
export const PENDING_FILE = '~/.claude/stool/restart-pending.json'
async function homeFile($: $T, p: string) {
  const home = ((await $.env.get('USERPROFILE').catch(() => undefined)) ?? (await $.env.get('HOME').catch(() => undefined))) as string | undefined
  return p.startsWith('~') && home ? home.split(String.fromCharCode(92)).join('/') + p.slice(1) : p
}
async function mark($: $T, pendingNow: boolean) {
  const file = await homeFile($, PENDING_FILE)
  const at = await $.clock.now().catch(() => Date.now())
  await $.fs.write(file, JSON.stringify({ pending: pendingNow, at })).catch(() => undefined)
}
async function finish($: $T) {
  pending = undefined
  model = undefined
  cleared = false
  compacting = false
  tries = 0
  clearFails = 0
  await mark($, false).catch(() => undefined)
}

// the `## <heading>` block of a handoff: its header line up to the next `## ` header, cut at `cap` chars; '' when absent
export function resumeSection(body: string, heading = 'RESUME HERE', cap = RESUME_CAP) {
  const lines = body.split(/\r?\n/)
  const i = lines.findIndex(l => l.startsWith(`## ${heading}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && l.startsWith('## '))
  const s = lines.slice(i, j < 0 ? undefined : j).join('\n').trim()
  return s.length > cap ? `${s.slice(0, cap)}\n[... cut at ${cap} chars]` : s
}

// one line for /compact: what the summary keeps; the resume text itself is injected after it
export const compactFocus = (prompt: string, n: number) =>
  `stool restart #${n}: keep the current task state, open items, decisions and anything unverified; the resume prompt and the handoff's RESUME HERE block are injected after this summary, so do not copy them. Next: ${prompt.replace(/\s+/g, ' ').trim().slice(0, 300)}`

// what SessionStart(compact) injects: the agent's resume prompt and the handoff's block, read fresh from disk
async function resumeContext($: $T, prompt: string) {
  const cwd = String(await Promise.resolve().then(() => $.session.cwd()).catch(() => '.')).split(String.fromCharCode(92)).join('/')
  const f = cfg.resumeFile
  const path = /^([a-z]:)?[\\/]/i.test(f) ? f : `${cwd}/${f}`
  let block = ''
  let why = ''
  try {
    block = resumeSection(await $.fs.read(path), cfg.heading)
    if (!block) why = `${f} has no "## ${cfg.heading}" section`
  } catch {
    why = `${f} could not be read`
  }
  return [
    `stool restart #${restartN}, compact mode: restart_session compacted this conversation. The agent's resume prompt from before the restart:`,
    prompt,
    block ? `The ${cfg.heading} block of ${f}, read from disk now:\n\n${block}` : `(Only the resume prompt was injected: ${why}.)`,
  ].join('\n\n')
}
// reload_plugins rewrites hooks/reload-stamp.ts: the plugin watcher (CLAUDE_CODE_PLUGIN_DIR_WATCH) reloads the module
// when a source file changes, before the next stool tool or at turn end. Works over Remote Control, where
// /reload-plugins is refused. ($.config.set cannot do it: the engine lists no row for the plugin's options, so
// 'stool.reloadNonce' is rejected; found 2026-11-07.)
const RELOAD = 'mcp__stool__reload_plugins'
// local runtime state (skip-worktree in git); the number means nothing, only that the file changed
const WRITE_STAMP = "require('fs').writeFileSync(process.argv[1], 'export const RELOAD_STAMP = ' + Date.now() + ' // rewritten by reload_plugins')"

export const RESTART_TOOL: ToolSpec = {
  name: 'restart_session',
  description:
    'Fresh context in this same session: once the current turn ends, runs /clear and submits `prompt` as the next user message (option restartMode "clear", the default); with restartMode "compact" it runs /compact, injects `prompt` and the handoff RESUME HERE block as context, and starts the next turn with a background-task notification. Permission mode, Remote Control and the session itself stay. Commit and write the handoff first; end the turn right after calling this. `model` is optional; switches this session to that model before the resume prompt.',
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
    'Reloads stool once the current turn ends by rewriting a source file the plugin watcher reloads on (works locally and over Remote Control), so stool edits load without the user typing /reload-plugins. Reloads stool only, not other plugins. Call it only when the user asked for a reload or for a stool change to take effect.',
  inputSchema: { type: 'object', properties: {} },
  isDeferred: true,
}

// the standing lessons pass: every session-restart retrospective runs it; a review tier runs it deeper
export const LESSONS =
  "Lessons pass: turn each mistake made more than once into a dated one-line lesson in the `## Lessons` list of the project skill for that area (newest first, at most ~15: merge duplicates, fold durable ones into the skill's rules, drop stale ones). Where an area keeps needing the same instructions and has no skill, propose a new project skill to the user. A lesson hit twice becomes a check script, not more prose. Foot-guns: list what slows the work, each with its evidence (a time, a token count, a commit), and fix or assign each one."

const TIER_TEXT: Record<Tier['type'], (t: Tier, n: number) => string> = {
  'why-behind': (t, n) =>
    `Why-behind review ("${t.name}", restart ${n}, every ${t.every}): check the goal against the gap before continuing. For each goal metric the project tracks: its value now vs the target in absolute units, and how long since it last moved (handoff history, commits, results). Is the current work attacking the measured gap, or tuning around it? If the approach cannot reach the goal at its present rate, rethink the approach instead of tuning it. Tell the user the decision in two lines (with the project's notify command if they are away). Run the lessons pass over the last ${t.every} restarts.`,
  deep: (t, n) =>
    `Deep review ("${t.name}", restart ${n}, every ${t.every}): read the last ~${t.every} restarts' handoff history, the fix log, the project's skills with their Lessons, and the results. Find where time, tokens and tries went against the progress they bought, rules broken more than once that still have no check script, tools that broke or stalled, and work that drifted into small tuning. Write \`docs/research/deep_review_${n}.md\` with ranked fixes, the lessons pass (consolidate every skill's Lessons) and a foot-guns section; apply the cheap fixes, and send the user the top 3 with the project's notify command. Run it inline; dispatching strong-model agents for it needs the user's OK.`,
}

// the resume prompt with the review tiers due at restart `n` in front of it; unchanged when none is due
export function withReviews(prompt: string, tiers: Tier[], n: number) {
  const due = dueTiers(tiers, n)
  if (due.length === 0) return { text: prompt, due }
  const text = [`Restart ${n}: a review is due first (stool option reviewTiers), then the task below.`, ...due.map(t => TIER_TEXT[t.type](t, n)), LESSONS, `Then: ${prompt}`].join('\n\n')
  return { text, due }
}

export const COUNT_FILE = 'docs/restart_count.txt'

export const register: Register = (on, options) => {
  const tiers = parseTiers(options?.reviewTiers)
  cfg = {
    mode: opt(options, 'restartMode', 'clear').trim().toLowerCase() === 'compact' ? 'compact' : 'clear',
    resumeFile: opt(options, 'resumeFile').trim() || 'docs/HANDOFF.md',
    heading: opt(options, 'restartHandoffHeading').trim() || 'RESUME HERE',
  }
  on('session.start', { cwd: /[^]*|a{6}/ }, async ($, e, next) => {
    await $.tool.register(RESTART_TOOL)
    await $.tool.register(RELOAD_TOOL)
    return next(e)
  })

  on('tool.call', { tool: RELOAD }, async $ => {
    const res = await $.process.run(['node', '-e', WRITE_STAMP, $.plugin.root + '/hooks/reload-stamp.ts']).catch((err: unknown) => ({ exitCode: -1, stderr: String(err) }))
    if (res.exitCode !== 0) return { result: `Reload failed: could not rewrite reload-stamp.ts (${String(res.stderr).trim().slice(0, 200)}).` }
    return { result: `Reload queued: stool reloads (reload-stamp rewritten, was ${RELOAD_STAMP}) before the next stool tool call or when this turn ends.` }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const prompt = (e as unknown as { prompt?: unknown }).prompt
    if (typeof prompt !== 'string' || !prompt.trim()) return { deny: 'restart_session: prompt is required.' }
    // the restart's number, bumped by session-restart in its handoff commit; a due tier goes in front of the prompt
    const cwd = await Promise.resolve().then(() => $.session.cwd()).catch(() => '.')
    const n = parseInt(await Promise.resolve().then(() => $.fs.read(`${cwd}/${COUNT_FILE}`)).catch(() => ''), 10)
    const r = withReviews(prompt, tiers, Number.isFinite(n) ? n : 0)
    pending = r.text
    mode = cfg.mode
    restartN = Number.isFinite(n) ? n : 0
    focus = compactFocus(prompt, restartN)
    compacting = injected = false
    cleared = false
    tries = 0
    clearFails = 0
    await mark($, true).catch(() => undefined)
    const m = (e as unknown as { model?: unknown }).model
    model = undefined
    let note = ''
    if (typeof m === 'string' && m.trim()) {
      if (/^[\w.[\]-]+$/.test(m.trim())) {
        model = m.trim()
        note = ` The model switches to ${model} before the prompt.`
      } else note = ' The model was not changed (unrecognised model name).'
    }
    const review = r.due.length ? ` Restart ${n}: ${r.due.map(t => t.name).join(' + ')} review added in front of the prompt.` : ''
    const how =
      mode === 'compact'
        ? `Restart queued (compact mode, restart #${restartN}): /compact runs when this turn ends, the resume prompt and the ${cfg.heading} block of ${cfg.resumeFile} go in as context after the summary, and a background-task wake starts the next turn.`
        : 'Restart queued: /clear and the resume prompt run when this turn ends.'
    return { result: `${how}${review}${note} End the turn now.` }
  })

  // a compact restart's resume text, added to the compacted context once; a compaction that is not ours adds nothing
  on('classic.SessionStart', { source: /[^]*|a{46}/ }, async ($, e, next) => {
    const r = await next(e)
    if (e.source !== 'compact' || !compacting || injected || pending === undefined) return r
    injected = true
    const ctx = await resumeContext($, pending)
    const prev = (r as { additionalContext?: string[] } | undefined)?.additionalContext ?? []
    return { ...(r ?? {}), additionalContext: [...prev, ctx] } as typeof r
  })

  on('turn.start', { turnId: /[^]*|a{45}/ }, async (_$, e, next) => {
    if (e.agentId === undefined) {
      busy = true
      waking = undefined // whatever started this turn, the session is awake
    }
    return next(e)
  })

  on('turn.complete', { reason: /[^]*|a{7}/ }, async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    busy = false
    if (pending === undefined) return done
    // outside the turn's hooks: command.run and prompt.submit refuse to run inside a hook the turn waits on
    $.clock.after(1000, () => void attempt($))
    return done
  })
}

// One try at the restart: /clear and /model once, then the prompt. The prompt stays pending until a submit takes it, so a
// turn that started after the clear (a tripwire wake, 2026-11-08 restart #119) cannot lose it: the failed or refused
// submit is retried when that turn completes, or on a timer, MAX_TRIES times in all.
async function attempt($: $T) {
  const text = pending
  if (text === undefined || trying) return
  if (busy) return // a turn runs: its turn.complete tries again
  trying = true
  try {
    if (!cleared) {
      if (mode === 'compact') {
        compacting = true
        await $.command.run({ command: 'compact', args: focus })
      } else await $.command.run({ command: 'clear' })
      cleared = true
      // an unknown model must not block the restart; /model answers with text or throws
      if (model) await $.command.run({ command: 'model', args: model }).catch(err => $.ui.toast(`model not changed: ${String(err)}`))
    }
    if (mode === 'compact') {
      // a turn that began after the compaction reads the injected context: no wake needed
      if (!busy) {
        tries++
        await wake($)
      }
      await finish($)
      return
    }
    if (busy) return // a wake turn began after the clear: its turn.complete submits
    tries++
    const r = (await $.prompt.submit({ text, asUser: true })) as { drop?: unknown } | undefined
    if (r && typeof r.drop === 'string') throw new Error(`dropped: ${r.drop}`)
    await finish($)
  } catch (err) {
    if (tries >= MAX_TRIES || (!cleared && ++clearFails >= MAX_TRIES)) {
      $.ui.toast(`fresh-restart failed, the resume prompt was NOT delivered: ${String(err)}`)
      await finish($)
    } else {
      $.ui.toast(`fresh-restart: ${String(err).slice(0, 120)}; trying again`)
      $.clock.after(RETRY_MS, () => void attempt($))
    }
  } finally {
    trying = false
  }
}

// Starts the turn after a compact restart without a user message, the way tripwire wakes: a background Bash `cat` of a
// file, whose task notification starts a turn in the idle session. If the call is refused, or no turn starts within
// CONFIRM_MS, a framed plugin prompt ("The stool plugin sent a message", not the person's words) goes instead.
async function wake($: $T) {
  const body = injected
    ? `stool restart #${restartN}, compact mode: the compaction is done and the resume context is above, after the summary. Continue with it now.`
    : `stool restart #${restartN}, compact mode: the compaction is done, but no resume context was injected at it (SessionStart compact did not reach stool), so here it is.\n\n${pending ? await resumeContext($, pending) : ''}`
  injected = true // a late SessionStart(compact) must not add it twice
  try {
    const file = await homeFile($, WAKE_FILE)
    await $.fs.write(file, body + '\n')
    const r = (await $.tool.call({ tool: 'Bash', command: `cat '${file}'`, description: WAKE_DESC, run_in_background: true } as never)) as { deny?: string; isError?: boolean; text?: string }
    if (r.deny || r.isError) throw new Error(String(r.deny ?? r.text ?? 'the Bash call erred').slice(0, 200))
    if (busy) return // a running turn takes the notice into itself
    waking = { body }
    $.clock.after(CONFIRM_MS, () => void confirm($))
  } catch (err) {
    await fallback($, body, `the background-task wake could not start (${String(err).slice(0, 160)})`)
  }
}

async function confirm($: $T) {
  const w = waking
  if (!w || busy) return
  waking = undefined
  await fallback($, w.body, `the background-task wake started no turn in ${CONFIRM_MS / 1000} s`).catch(err => $.ui.toast(`stool restart wake not delivered: ${String(err).slice(0, 120)}`))
}

async function fallback($: $T, body: string, why: string) {
  const r = (await $.prompt.submit({ text: `[automated, not the user: stool restart wake] ${body}\n(stool sent this as a prompt because ${why}.)` })) as { drop?: unknown } | undefined
  if (r && typeof r.drop === 'string') throw new Error(`dropped: ${r.drop}`)
}
